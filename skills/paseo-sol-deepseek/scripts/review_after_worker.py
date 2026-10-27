"""Use one native completion wait, then collect the existing independent review."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import UUID

# This installed helper must not create bytecode in the global skill directory.
sys.dont_write_bytecode = True
from team_context import review

PASEO = '/Applications/Paseo.app/Contents/Resources/bin/paseo'


def wait_and_review(cwd, agent_id, base, command, protected, seconds=1200,
                    cli=PASEO, execute=subprocess.run, collect=review):
    UUID(agent_id)
    if not 1 <= seconds <= 1200:
        raise ValueError('Wait budget must be between 1 and 1200 seconds')
    argv = [str(cli), 'agent', 'wait', agent_id, '--timeout', str(seconds) + 's', '--json']
    try:
        result = execute(argv, cwd=cwd, capture_output=True, text=True,
                         timeout=seconds + 15, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    except subprocess.TimeoutExpired:
        return {'status': 'WAIT_TIMEOUT', 'agentId': agent_id, 'review': None,
                'workerMayStillBeRunning': True}
    if result.returncode != 0:
        return {'status': 'WAIT_COMMAND_FAILED', 'agentId': agent_id, 'review': None,
                'exitCode': result.returncode, 'error': result.stderr[-2000:],
                'workerMayStillBeRunning': True}
    try:
        state = json.loads(result.stdout)
    except (ValueError, TypeError):
        return {'status': 'WAIT_INVALID_OUTPUT', 'agentId': agent_id, 'review': None}
    if not isinstance(state, dict) or state.get('agentId') != agent_id:
        return {'status': 'WAIT_IDENTITY_MISMATCH', 'agentId': agent_id, 'review': None}
    if state.get('status') != 'idle':
        return {'status': 'WAIT_' + str(state.get('status', 'unknown')).upper(),
                'agentId': agent_id, 'review': None,
                'workerMayStillBeRunning': state.get('status') == 'timeout'}
    # Idle is completion evidence, not acceptance. Keep all real checks and patch evidence.
    packet = collect(cwd, base, command, protected)
    return {'status': 'REVIEW_READY', 'agentId': agent_id, 'review': packet}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agent-id', required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--test-command', required=True)
    parser.add_argument('--protected', action='append', default=[])
    parser.add_argument('--wait-seconds', type=int, default=1200)
    args = parser.parse_args()
    try:
        packet = wait_and_review(Path.cwd().resolve(), args.agent_id, args.base,
                                 args.test_command, args.protected, args.wait_seconds)
    except (ValueError, OSError, UnicodeError) as exc:
        packet = {'status': 'REVIEW_ERROR', 'agentId': args.agent_id, 'error': str(exc)}
    print(json.dumps(packet, ensure_ascii=False))
    return 0 if packet['status'] == 'REVIEW_READY' else 2


if __name__ == '__main__':
    raise SystemExit(main())
