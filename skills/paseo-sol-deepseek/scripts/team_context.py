"""Read a file assignment, or collect a complete review packet. No model calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys


def run(argv, cwd, timeout=30, extra_env=None):
    try:
        result = subprocess.run(argv, cwd=cwd, env={**os.environ, **(extra_env or {}), 'PYTHONDONTWRITEBYTECODE': '1',
                                                   'GIT_OPTIONAL_LOCKS': '0'},
                                capture_output=True, text=True, timeout=timeout)
        return {'command': shlex.join(argv), 'exitCode': result.returncode,
                'stdout': result.stdout, 'stderr': result.stderr}
    except subprocess.TimeoutExpired:
        return {'command': shlex.join(argv), 'exitCode': None, 'error': 'TIMEOUT'}


def git(cwd, *args):
    result = run(['git', *args], cwd)
    if result.get('exitCode') != 0:
        raise ValueError('Git inspection failed: ' + ' '.join(args))
    return result['stdout']


def inside(cwd, name):
    path = (cwd / name).resolve()
    if not path.is_relative_to(cwd):
        raise ValueError('Path escapes current task directory: ' + name)
    return path


def read_text(path, limit=120000):
    data = path.read_bytes()
    if len(data) > limit:
        raise ValueError('File needs focused inspection: ' + str(path))
    return data.decode('utf-8')


def prepare(cwd, task):
    path = inside(cwd, task)
    task_text = read_text(path)
    if not task_text.strip():
        raise ValueError('Empty task file')
    instructions = []
    for directory in reversed([path.parent, *path.parent.parents]):
        if directory.is_relative_to(cwd):
            candidate = directory / 'AGENTS.md'
            if candidate.is_file():
                instructions.append({'path': str(candidate.relative_to(cwd)),
                                     'text': read_text(inside(cwd, str(candidate.relative_to(cwd))))})
    revision = git(cwd, 'rev-parse', '--verify', 'HEAD').strip()
    status = git(cwd, 'status', '--short', '--untracked-files=all')
    assignment = (
        'Complete the explicit file assignment below in the current shared workspace. '
        'You are the one persistent implementation worker. Follow the task scope, protected files, '
        'repository instructions and user permissions. Preserve pre-existing edits; do not create '
        'additional agents or change models or global settings. Investigate relevant source yourself, '
        'implement, add the requested behavioral tests, run the required checks, inspect all your '
        'changes, and repair in-scope failures. If your checks fail, diagnose and fix them in this '
        'same session before reporting completion; do not ask Sol to approve each local repair step. '
        'Report changed files, actual commands and exit codes, '
        'self-review and unresolved issues in at most eight bullets. Do not claim unrun checks.\n\n'
        f'Workspace: {cwd}\nStarting revision: {revision}\nInitial git status:\n{status or "clean"}\n\n'
        + '\n\n'.join(f'Repository instructions {item["path"]}:\n{item["text"]}' for item in instructions)
        + f'\n\nAssignment {path.relative_to(cwd)}:\n{task_text}'
    )
    return {'cwd': str(cwd), 'revision': revision, 'initialStatus': status,
            'taskPath': str(path.relative_to(cwd)), 'taskSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'taskText': task_text, 'initialPrompt': assignment}


def review(cwd, base, command, protected):
    revision = git(cwd, 'rev-parse', '--verify', base + '^{commit}').strip()
    patch = git(cwd, 'diff', '--no-ext-diff', '--no-textconv', revision, '--')
    untracked = [x for x in git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split('\0') if x]
    new_files = [{'path': name, 'text': read_text(inside(cwd, name))} for name in untracked]
    if len(patch.encode()) + sum(len(item['text'].encode()) for item in new_files) > 180000:
        raise ValueError('Review packet too large; inspect focused patches before acceptance')
    protected_changes = []
    for name in protected:
        inside(cwd, name)
        if git(cwd, 'diff', '--no-ext-diff', '--no-textconv', revision, '--', name):
            protected_changes.append(name)
    argv = shlex.split(command)
    assignments = {}
    while argv and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', argv[0]):
        name, value = argv.pop(0).split('=', 1)
        assignments[name] = value
    if not argv:
        raise ValueError('Missing independent test command')
    tests = run(argv, cwd, timeout=60, extra_env=assignments)
    tests['requestedCommand'] = command
    if tests.get('exitCode') == 0:
        tests['stdout'] = '\n'.join(tests.get('stdout', '').splitlines()[-8:])
        tests['stderr'] = '\n'.join(tests.get('stderr', '').splitlines()[-8:])
    else:
        for key in ('stdout', 'stderr'):
            if len(tests.get(key, '')) > 18000:
                tests[key] = tests[key][-18000:]
                tests['outputTruncated'] = True
    return {'base': revision, 'head': git(cwd, 'rev-parse', 'HEAD').strip(),
            'status': git(cwd, 'status', '--short', '--untracked-files=all'),
            'trackedPatch': patch, 'newFiles': new_files,
            'protectedChanges': protected_changes,
            'diffCheck': run(['git', 'diff', '--check', revision, '--'], cwd),
            'independentTests': tests,
            'acceptance': 'UNDECIDED: Sol must review the patch, tests and task contract'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cwd', default='.')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--task', required=True)
    p = sub.add_parser('review')
    p.add_argument('--base', required=True)
    p.add_argument('--test-command', required=True)
    p.add_argument('--protected', action='append', default=[])
    args = parser.parse_args()
    cwd = Path(args.cwd).resolve()
    try:
        packet = prepare(cwd, args.task) if args.action == 'prepare' else review(
            cwd, args.base, args.test_command, args.protected)
        print(json.dumps(packet, ensure_ascii=False))
    except (ValueError, OSError, UnicodeError) as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
