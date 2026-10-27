import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/paseo-sol-deepseek/scripts/team_context.py'
spec = importlib.util.spec_from_file_location('team_context', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Packets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        for args in [['init', '-q'], ['config', 'user.name', 'Fixture'],
                     ['config', 'user.email', 'fixture@example.invalid']]:
            subprocess.run(['git', *args], cwd=self.repo, check=True, capture_output=True)
        (self.repo / 'TASK.md').write_text('구현과 행동 테스트. source.py만 수정.\n')
        (self.repo / 'AGENTS.md').write_text('보호 파일 유지.\n')
        (self.repo / 'source.py').write_text('answer = 0\n')
        subprocess.run(['git', 'add', '.'], cwd=self.repo, check=True)
        subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=self.repo, check=True)
        self.base = module.git(self.repo, 'rev-parse', 'HEAD').strip()

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, python):
        return shlex.join([sys.executable, '-c', python])

    def test_prepare_carries_contract_instructions_and_initial_dirty_state_without_writes(self):
        (self.repo / 'source.py').write_text('answer = 1\n')
        before = {str(p): p.read_bytes() for p in self.repo.rglob('*') if p.is_file()}
        packet = module.prepare(self.repo, 'TASK.md')
        self.assertIn('source.py', packet['initialStatus'])
        self.assertIn('구현과 행동 테스트', packet['initialPrompt'])
        self.assertIn('보호 파일 유지', packet['initialPrompt'])
        self.assertEqual(packet['revision'], self.base)
        after = {str(p): p.read_bytes() for p in self.repo.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_assignment_path_escape_and_symlink_are_rejected(self):
        (self.root / 'outside.md').write_text('outside')
        (self.repo / 'link.md').symlink_to(self.root / 'outside.md')
        for task in ['../outside.md', 'link.md']:
            with self.assertRaises(ValueError):
                module.prepare(self.repo, task)

    def test_review_includes_staged_and_untracked_content_with_independent_success(self):
        (self.repo / 'source.py').write_text('answer = 42\n')
        subprocess.run(['git', 'add', 'source.py'], cwd=self.repo, check=True)
        (self.repo / 'new_test.py').write_text('assert 6 * 7 == 42\n')
        packet = module.review(self.repo, self.base, self.command('print("CHECKED")'), ['TASK.md'])
        self.assertIn('+answer = 42', packet['trackedPatch'])
        self.assertEqual(packet['newFiles'], [{'path': 'new_test.py', 'text': 'assert 6 * 7 == 42\n'}])
        self.assertEqual(packet['independentTests']['exitCode'], 0)
        self.assertIn('CHECKED', packet['independentTests']['stdout'])
        self.assertEqual(packet['protectedChanges'], [])
        self.assertTrue(packet['acceptance'].startswith('UNDECIDED'))

    def test_failed_test_and_protected_change_are_reported_as_evidence(self):
        (self.repo / 'TASK.md').write_text('changed contract')
        packet = module.review(self.repo, self.base, self.command('import sys; sys.exit(3)'), ['TASK.md'])
        self.assertEqual(packet['protectedChanges'], ['TASK.md'])
        self.assertEqual(packet['independentTests']['exitCode'], 3)

    def test_environment_prefixed_command_runs_with_literal_values_without_shell_evaluation(self):
        literal = '$(touch unintended-file)'
        program = 'import os; print(os.environ["TEAM_CONTEXT_LITERAL"]); assert os.environ["PYTHONDONTWRITEBYTECODE"] == "1"'
        cmd = shlex.join(['PYTHONDONTWRITEBYTECODE=1', 'TEAM_CONTEXT_LITERAL=' + literal,
                          sys.executable, '-c', program])
        packet = module.review(self.repo, self.base, cmd, ['TASK.md'])
        self.assertEqual(packet['independentTests']['exitCode'], 0)
        self.assertEqual(packet['independentTests']['stdout'], literal)
        self.assertFalse((self.repo / 'unintended-file').exists())


if __name__ == '__main__':
    unittest.main()
