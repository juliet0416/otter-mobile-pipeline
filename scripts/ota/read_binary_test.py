import importlib.util
import json
import pathlib
import plistlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('reader', pathlib.Path(__file__).with_name('read-binary.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class BinaryTests(unittest.TestCase):
    def fixture(self, folder, suffix, runtime='a' * 40, enabled=True):
        file = pathlib.Path(folder) / ('app.' + suffix)
        config = dict(version='1.4.8', updates=dict(enabled=enabled, url='https://u.expo.dev/project', requestHeaders={'expo-channel-name': 'prod'}))
        with zipfile.ZipFile(file, 'w') as z:
            if suffix == 'ipa':
                prefix = 'Payload/App.app/'
                z.writestr(prefix + 'Expo.plist', plistlib.dumps(dict(EXUpdatesEnabled=enabled, EXUpdatesURL='https://u.expo.dev/project', EXUpdatesRequestHeaders={'expo-channel-name': 'prod'})))
                z.writestr(prefix + 'EXConstants.bundle/app.config', json.dumps(config))
                z.writestr(prefix + 'EXUpdates.bundle/fingerprint', runtime)
            else:
                prefix = 'base/assets/' if suffix == 'aab' else 'assets/'
                z.writestr(prefix + 'app.config', json.dumps(config))
                z.writestr(prefix + 'fingerprint', runtime)
        return file

    def test_all_native_formats(self):
        with tempfile.TemporaryDirectory() as folder:
            for suffix in ('apk', 'aab', 'ipa'):
                with self.subTest(suffix=suffix):
                    info = reader.read_binary(self.fixture(folder, suffix))
                    self.assertEqual(info['runtimeVersion'], 'a' * 40)
                    self.assertEqual(info['channel'], 'prod')
                    self.assertEqual(info['version'], '1.4.8')
                    self.assertEqual(len(info['sha256']), 64)

    def test_disabled_or_invalid_runtime_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            for suffix in ('apk', 'aab', 'ipa'):
                for options in (dict(enabled=False), dict(runtime='file:fingerprint')):
                    with self.subTest(suffix=suffix, options=options), self.assertRaises(ValueError):
                        reader.read_binary(self.fixture(folder, suffix, **options))


if __name__ == '__main__':
    unittest.main()
