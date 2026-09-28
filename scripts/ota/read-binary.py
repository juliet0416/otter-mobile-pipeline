"""Read OTA identity from an APK/AAB/IPA without extracting its contents."""
import hashlib
import json
import pathlib
import plistlib
import re
import sys
import zipfile


def read_binary(filename):
    filename = pathlib.Path(filename)
    with zipfile.ZipFile(filename) as archive:
        names = archive.namelist()
        if filename.suffix == '.ipa':
            platform = 'ios'
            candidates = [n for n in names if re.fullmatch(r'Payload/[^/]+\.app/Expo.plist', n)]
            if len(candidates) != 1:
                raise ValueError('IPA must contain exactly one main Expo.plist')
            prefix = candidates[0][:-len('Expo.plist')]
            updates = plistlib.loads(archive.read(candidates[0]))
            config = json.loads(archive.read(prefix + 'EXConstants.bundle/app.config'))
            runtime = archive.read(prefix + 'EXUpdates.bundle/fingerprint').decode().strip()
            enabled = updates.get('EXUpdatesEnabled') is True
            channel = updates.get('EXUpdatesRequestHeaders', {}).get('expo-channel-name')
            url = updates.get('EXUpdatesURL')
        elif filename.suffix in ('.apk', '.aab'):
            platform = 'android'
            prefix = 'base/assets/' if filename.suffix == '.aab' else 'assets/'
            config = json.loads(archive.read(prefix + 'app.config'))
            runtime = archive.read(prefix + 'fingerprint').decode().strip()
            updates = config.get('updates', {})
            enabled = updates.get('enabled') is True
            channel = updates.get('requestHeaders', {}).get('expo-channel-name')
            url = updates.get('url')
        else:
            raise ValueError('Only APK/AAB/IPA are supported')
        if not re.fullmatch('[a-f0-9]{40}', runtime):
            raise ValueError('Native fingerprint is missing or invalid')
        if not enabled:
            raise ValueError('Embedded updates are disabled')
    with filename.open('rb') as stream:
        hasher = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
        digest = hasher.hexdigest()
    return dict(name=filename.name, sha256=digest, platform=platform,
                version=config.get('version'), runtimeVersion=runtime, channel=channel, updateUrl=url)


if __name__ == '__main__':
    print(json.dumps(read_binary(sys.argv[1])))
