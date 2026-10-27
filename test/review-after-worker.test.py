import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'skills/paseo-sol-deepseek/scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('review_after_worker', SCRIPTS / 'review_after_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
AGENT = '62a3de59-3f55-4118-9cf8-083ceab0f302'


class Completion(unittest.TestCase):
    def simulate(self, stdout, returncode=0):
        calls = []
        def execute(argv, **kwargs):
            calls.append(('wait', argv, kwargs))
            return subprocess.CompletedProcess(argv, returncode, stdout, 'native stderr')
        def collect(*args):
            calls.append(('review', args))
            return {'trackedPatch': 'FULL PATCH', 'independentTests': {'exitCode': 1}}
        result = module.wait_and_review(Path('/private/tmp'), AGENT, 'base', 'required tests', ['TASK.md'],
                                        execute=execute, collect=collect)
        return result, calls

    def test_one_idle_wait_precedes_complete_independent_review_even_when_tests_fail(self):
        result, calls = self.simulate(json.dumps({'agentId': AGENT, 'status': 'idle', 'message': 'not forwarded'}))
        self.assertEqual([x[0] for x in calls], ['wait', 'review'])
        self.assertEqual(result['status'], 'REVIEW_READY')
        self.assertEqual(result['review']['independentTests']['exitCode'], 1)
        self.assertNotIn('message', result)
        self.assertEqual(calls[0][1][1:4], ['agent', 'wait', AGENT])

    def test_permissions_errors_timeouts_and_identity_mismatch_never_collect_or_accept(self):
        for status in ['permission', 'timeout', 'error', 'unknown']:
            with self.subTest(status=status):
                result, calls = self.simulate(json.dumps({'agentId': AGENT, 'status': status}))
                self.assertNotEqual(result['status'], 'REVIEW_READY')
                self.assertEqual(len(calls), 1)
                self.assertIsNone(result['review'])
        for text in ['not json', json.dumps({'agentId': 'other', 'status': 'idle'}), '[]']:
            result, calls = self.simulate(text)
            self.assertNotEqual(result['status'], 'REVIEW_READY')
            self.assertEqual(len(calls), 1)

    def test_native_command_error_and_process_timeout_are_not_success(self):
        result, calls = self.simulate('', returncode=3)
        self.assertEqual(result['status'], 'WAIT_COMMAND_FAILED')
        self.assertEqual(len(calls), 1)
        def timed_out(*args, **kwargs):
            raise subprocess.TimeoutExpired('native wait', 2)
        result = module.wait_and_review(Path('/private/tmp'), AGENT, 'base', 'tests', [], execute=timed_out)
        self.assertEqual(result['status'], 'WAIT_TIMEOUT')

    def test_real_fake_cli_exits_before_review_without_any_provider_or_status_poll(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / 'fake paseo'
            cli.write_text('#!' + sys.executable + '\nimport json,sys\nfrom pathlib import Path\n'
                           'assert sys.argv[1:3] == ["agent", "wait"]\n'
                           'Path("completed-marker").write_text("done")\n'
                           'print(json.dumps({"agentId":sys.argv[3],"status":"idle"}))\n')
            cli.chmod(0o700)
            def collect(*args):
                self.assertEqual((root / 'completed-marker').read_text(), 'done')
                return {'trackedPatch': 'CHECKED AFTER NATIVE EXIT'}
            result = module.wait_and_review(root, AGENT, 'base', 'tests', [], cli=cli, collect=collect)
            self.assertEqual(result['review']['trackedPatch'], 'CHECKED AFTER NATIVE EXIT')

    def test_bad_identity_or_unbounded_budget_starts_no_command(self):
        for identity, seconds in [('not-a-uuid', 10), (AGENT, 0), (AGENT, 1201)]:
            with self.assertRaises(ValueError):
                module.wait_and_review(Path('/private/tmp'), identity, 'base', 'tests', [], seconds,
                                        execute=lambda *a, **k: self.fail('must not execute'))


if __name__ == '__main__':
    unittest.main()
