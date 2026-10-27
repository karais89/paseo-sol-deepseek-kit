import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'skills/paseo-sol-deepseek/scripts/sol_judge.py'
spec=importlib.util.spec_from_file_location('sol_judge',SCRIPT)
judge=importlib.util.module_from_spec(spec);spec.loader.exec_module(judge)
THREAD='62a3de59-3f55-4118-9cf8-083ceab0f302'
ACCEPT={'action':'accept','summary':'Reviewed','defects':[]}
CORRECT={'action':'correct','summary':'Defect','defects':[{'requirement':'five fields','expected':'ValueError','observed':'accepted'}]}


class Reviewer(unittest.TestCase):
    def events(self,decision=ACCEPT,extra=None):
        rows=[{'type':'thread.started','thread_id':THREAD},
              {'type':'item.completed','item':{'type':'error','message':'startup diagnostic'}},
              {'type':'turn.started'}]
        if extra:rows.append(extra)
        rows += [{'type':'item.completed','item':{'type':'agent_message','text':json.dumps(decision)}},
                 {'type':'turn.completed','usage':{'input_tokens':20,'cached_input_tokens':0,'output_tokens':10}}]
        return subprocess.CompletedProcess([],0,'\n'.join(json.dumps(x) for x in rows),'')

    def test_valid_first_and_corrected_decisions_keep_identity_and_actual_usage(self):
        first=judge.parse_result(self.events(CORRECT));last=judge.parse_result(self.events(),True,THREAD)
        self.assertEqual(first['decision'],CORRECT);self.assertEqual(last['threadId'],THREAD)
        self.assertEqual(last['usage']['input_tokens'],20)
        self.assertIsNone(last['providerResponseCount'])

    def test_unknown_actions_extra_fields_and_contradictory_acceptance_fail(self):
        for value in [{**ACCEPT,'action':'exec_command'},{**ACCEPT,'command':'cat MEMORY.md'},
                      {**ACCEPT,'defects':CORRECT['defects']},{**CORRECT,'defects':[]},
                      {**CORRECT,'defects':[{'requirement':'r','expected':'e','observed':'o','path':'/private'}]}]:
            with self.subTest(value=value),self.assertRaises(ValueError):judge.validate_decision(value)
        with self.assertRaises(ValueError):judge.validate_decision(CORRECT,True)

    def test_tool_attempt_or_failure_never_becomes_acceptance(self):
        for kind in ['command_execution','mcp_tool_call','file_change','plan','web_search']:
            with self.subTest(kind=kind),self.assertRaises(ValueError):
                judge.parse_result(self.events(extra={'type':'item.started','item':{'type':kind}}))
        failed=self.events();failed.returncode=1
        with self.assertRaises(ValueError):judge.parse_result(failed)
        with self.assertRaises(ValueError):judge.parse_result(self.events(),expected_thread='other')

    def test_missing_usage_is_incomplete_and_duplicate_json_fields_are_rejected(self):
        run=self.events();run.stdout=run.stdout.replace('"input_tokens": 20','"missing_input": 20')
        self.assertEqual(judge.parse_result(run)['accounting'],'INCOMPLETE')
        with self.assertRaises(ValueError):json.loads('{"action":"accept","action":"correct"}',object_pairs_hook=judge.no_duplicate_keys)

    def test_only_read_only_native_route_with_exact_model_policy_is_constructed(self):
        command=judge.command('/codex','/private/tmp/review','/schema.json',THREAD)
        self.assertIn('--ignore-user-config',command);self.assertIn('--strict-config',command)
        self.assertIn('read-only',command);self.assertIn('resume',command)
        self.assertIn('features.shell_tool=false',command)
        self.assertIn('features.apps=false',command);self.assertIn('features.skip_host_skill_discovery=true',command)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',command)
        with self.assertRaises(ValueError):judge.command('/codex','/tmp','/schema',model='other')

    def test_missing_or_changed_tool_admission_blocks_before_model_execution(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);binary=root/'codex';binary.write_text('fixture binary');audit=root/'audit.json'
            value={'status':'PASS','advertisedTools':[],'binarySha256':judge.digest(binary),'policy':judge.overrides()}
            audit.write_text(json.dumps(value));self.assertEqual(judge.admission(audit,binary)['status'],'PASS')
            for key,replacement in [('advertisedTools',['exec_command']),('binarySha256','changed'),('policy',{}),('status','FAIL')]:
                changed=copy.deepcopy(value);changed[key]=replacement;audit.write_text(json.dumps(changed))
                with self.subTest(key=key),self.assertRaises(ValueError):judge.admission(audit,binary)


if __name__=='__main__':unittest.main()
