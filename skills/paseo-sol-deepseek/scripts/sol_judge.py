"""A tool-free Sol reviewer. The host, never Sol, executes workflow actions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from uuid import UUID

sys.dont_write_bytecode = True
SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'action': {'type': 'string', 'enum': ['accept', 'correct', 'fail']},
        'summary': {'type': 'string', 'minLength': 1, 'maxLength': 2000},
        'defects': {'type': 'array', 'maxItems': 8, 'items': {
            'type': 'object', 'additionalProperties': False,
            'properties': {name: {'type': 'string', 'minLength': 1, 'maxLength': 5000}
                           for name in ['requirement', 'expected', 'observed']},
            'required': ['requirement', 'expected', 'observed']}}
    }, 'required': ['action', 'summary', 'defects']}
DISABLED_FEATURES = [
    'shell_tool', 'apps', 'plugins', 'memories', 'hooks', 'multi_agent',
    'skill_search', 'view_image', 'browser_use', 'computer_use',
    'image_generation', 'goals', 'sleep_tool', 'tool_suggest',
    'workspace_dependencies', 'code_mode_host', 'chronicle',
    'enable_request_compression'
]


def overrides():
    values = {f'features.{name}': False for name in DISABLED_FEATURES}
    values.update({'features.skip_host_skill_discovery': True,
                   'features.code_mode.enabled': False, 'web_search': 'disabled',
                   'memories.use_memories': False,
                   'memories.generate_memories': False, 'project_doc_max_bytes': 0,
                   'model_reasoning_effort': 'high', 'service_tier': 'default'})
    return values


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_decision(value, corrected=False):
    if not isinstance(value, dict) or set(value) != {'action', 'summary', 'defects'}:
        raise ValueError('Decision contains unsupported fields or is incomplete')
    if value['action'] not in ['accept', 'correct', 'fail']:
        raise ValueError('Unsupported workflow action')
    if not isinstance(value['summary'], str) or not 1 <= len(value['summary']) <= 2000:
        raise ValueError('Invalid decision summary')
    defects = value['defects']
    if not isinstance(defects, list) or len(defects) > 8:
        raise ValueError('Invalid defect evidence')
    for defect in defects:
        if not isinstance(defect, dict) or set(defect) != {'requirement', 'expected', 'observed'}:
            raise ValueError('Defect must contain only requirement, expected and observed')
        if any(not isinstance(text, str) or not 1 <= len(text) <= 5000 for text in defect.values()):
            raise ValueError('Invalid defect evidence text')
    if value['action'] == 'correct' and (corrected or not defects):
        raise ValueError('Correction needs concrete evidence and is limited to one round')
    if value['action'] == 'accept' and defects:
        raise ValueError('Acceptance conflicts with unresolved defects')
    return value


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field')
        result[key] = value
    return result


def admission(audit_path, executable=None):
    executable = Path(executable or shutil.which('codex') or '').resolve()
    audit = json.loads(Path(audit_path).read_text())
    if audit.get('status') != 'PASS' or audit.get('advertisedTools') != []:
        raise ValueError('Missing successful native empty-tool inventory')
    if audit.get('binarySha256') != digest(executable):
        raise ValueError('Codex executable changed since the native inventory check')
    if audit.get('policy') != overrides():
        raise ValueError('Reviewer tool policy differs from the inspected policy')
    account_home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    config = account_home / 'config.toml'
    if config.is_file() and tomllib.loads(config.read_text()).get('model_provider', 'openai') != 'openai':
        raise ValueError('Current native provider is not openai; do not silently change it')
    return {'status': 'PASS', 'executable': str(executable),
            'binarySha256': audit['binarySha256'], 'advertisedTools': []}


def command(executable, cwd, schema_path, thread_id=None, model='gpt-6.1-sol', effort='high'):
    if (model, effort) != ('gpt-6.1-sol', 'high'):
        raise ValueError('This inspected route preserves Sol 6.1 high; other settings need inspection')
    argv = [str(executable), 'exec', '--strict-config', '--ignore-user-config', '--skip-git-repo-check',
            '--sandbox', 'read-only', '--json', '--model', model, '--cd', str(cwd),
            '--output-schema', str(schema_path)]
    for key, value in overrides().items():
        argv += ['-c', key + '=' + json.dumps(value)]
    if thread_id:
        UUID(thread_id)
        argv += ['resume', thread_id]
    return argv + ['-']


def parse_result(run, corrected=False, expected_thread=None):
    thread_id, messages, usage = None, [], []
    turn_started, startup_warnings = False, []
    for line in run.stdout.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get('type') == 'thread.started':
            thread_id = event['thread_id']
        if event.get('type') == 'turn.started':
            turn_started = True
        item = event.get('item', {})
        if event.get('type') in ['item.started', 'item.completed']:
            if not turn_started and item.get('type') == 'error':
                startup_warnings.append(item.get('message', ''))
                continue
            if item.get('type') not in ['agent_message', 'reasoning']:
                raise ValueError('Reviewer attempted a non-review tool or action')
            if event['type'] == 'item.completed' and item.get('type') == 'agent_message':
                messages.append(item.get('text', ''))
        if event.get('type') == 'turn.completed':
            usage.append(event.get('usage'))
        if event.get('type') == 'turn.failed':
            raise ValueError('Reviewer failed; do not retry automatically')
    if run.returncode or len(messages) != 1 or len(usage) != 1:
        raise ValueError('Incomplete reviewer evidence; do not retry automatically')
    if not thread_id or (expected_thread and expected_thread != thread_id):
        raise ValueError('Missing or changed reviewer thread identity')
    UUID(thread_id)
    decision = validate_decision(json.loads(messages[0], object_pairs_hook=no_duplicate_keys), corrected)
    counters = usage[0]
    complete = isinstance(counters, dict) and all(type(counters.get(k)) is int and counters[k] >= 0
                   for k in ['input_tokens', 'cached_input_tokens', 'output_tokens'])
    return {'status': 'REVIEW_DECISION', 'threadId': thread_id, 'decision': decision,
            'startupWarnings': startup_warnings,
            'usage': counters, 'usageScope': 'THREAD_CUMULATIVE_SNAPSHOT',
            'accounting': 'COMPLETE_THREAD_COUNTERS' if complete else 'INCOMPLETE',
            'providerResponseCount': None, 'providerResponseCountStatus': 'COLLECT_NATIVE_REQUEST_RECORDS'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True)
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--input')
    args = parser.parse_args()
    try:
        allowed = admission(args.audit)
        if args.preflight:
            print(json.dumps(allowed)); return 0
        if not args.input:
            raise ValueError('Missing host-owned review input')
        path = Path(args.input).resolve()
        if path.stat().st_size > 1000000:
            raise ValueError('Review packet requires focused host preparation')
        context = json.loads(path.read_text(), object_pairs_hook=no_duplicate_keys)
        corrected = context['phase'] == 'review_corrected'
        if context['phase'] not in ['review_initial', 'review_corrected']:
            raise ValueError('Invalid review phase')
        schema = path.parent / 'decision-schema.json'
        schema.write_text(json.dumps(SCHEMA) + '\n')
        prompt = ('Review the original contract and the complete real patch, tests and boundary evidence below. '
                  'You have no execution tools. Return only the requested JSON decision. '
                  'Use accept only when evidence and contract support it; correct only for concrete defects '
                  'within the original contract, including source-observable defects. The host owns execution '
                  'and permits only one corrective round. After that round use accept or fail. '
                  'Do not invent checks, claim unrun tests, add requirements or request shell/memory actions.\n'
                  + json.dumps(context, ensure_ascii=False))
        # The reviewer never uses the candidate's working directory/configuration.
        argv = command(allowed['executable'], path.parent, schema, context.get('threadId'))
        run = subprocess.run(argv, input=prompt, capture_output=True, text=True, timeout=300)
        result = parse_result(run, corrected, context.get('threadId'))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'status': 'GATED_REVIEW_FAILED', 'error': str(exc),
                          'automaticRetry': False}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
