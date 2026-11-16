const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.log('AndroidManifest.xml not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(manifestPath, 'utf8');

const requiredPermissions = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  '<uses-permission android:name="android.permission.BLUETOOTH" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
  '<uses-permission android:name="android.permission.READ_CONTACTS" />',
  '<uses-permission android:name="android.permission.CALL_PHONE" />',
  '<uses-permission android:name="android.permission.SEND_SMS" />',
  '<uses-permission android:name="android.permission.READ_CALENDAR" />',
  '<uses-permission android:name="android.permission.WRITE_CALENDAR" />',
  '<uses-permission android:name="com.android.alarm.permission.SET_ALARM" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
  '<uses-feature android:name="android.hardware.telephony" android:required="false" />'
];

for (const perm of requiredPermissions) {
  const matchName = perm.match(/android:name="([^"]+)"/);
  if (matchName && !content.includes(matchName[1])) {
    content = content.replace('</manifest>', `    ${perm}\n</manifest>`);
    console.log(`Added ${matchName[1]} to AndroidManifest.xml`);
  }
}

if (!content.includes('android:name=".SierraVoiceForegroundService"')) {
  const fgService = `        <service
            android:name=".SierraVoiceForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="microphone" />\n    </application>`;
  content = content.replace('</application>', fgService);
}

if (!content.includes('android:name=".SierraCallScreeningService"')) {
  const screeningService = `        <service
            android:name=".SierraCallScreeningService"
            android:permission="android.permission.BIND_SCREENING_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.telecom.CallScreeningService" />
            </intent-filter>
        </service>\n    </application>`;
  content = content.replace('</application>', screeningService);
}

if (!content.includes('com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl')) {
  const oauthIntentFilter = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl" android:path="/oauth2redirect" />
                <data android:scheme="com.sierra.omniagent" android:path="/oauth2redirect" />
                <data android:scheme="msauth" android:host="com.sierra.omniagent" />
            </intent-filter>\n        </activity>`;
  content = content.replace('        </activity>', oauthIntentFilter);
  console.log('Added OAuth redirect intent-filter to MainActivity in AndroidManifest.xml');
}

if (!content.includes('android:usesCleartextTraffic')) {
  content = content.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
}

fs.writeFileSync(manifestPath, content, 'utf8');
console.log('AndroidManifest.xml verified and patched successfully.');
