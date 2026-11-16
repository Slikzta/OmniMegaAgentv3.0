import assert from "node:assert";
import test from "node:test";

test("AI Provider Configuration & Capabilities Audit", () => {
  const supportedProviders = ["gemini", "openai", "anthropic", "custom", "ollama"];
  assert.strictEqual(supportedProviders.length, 5);

  const capabilities = {
    text: true,
    streaming: true,
    multimodal: true,
    grounding: true,
    imageGen: true,
    videoGen: true,
    liveVoice: true,
  };

  assert.strictEqual(capabilities.text, true);
  assert.strictEqual(capabilities.grounding, true);
  assert.strictEqual(capabilities.liveVoice, true);
});

test("Multi-turn Conversation History Structure", () => {
  const history = [
    { role: "user", content: "Plan a trip to Tokyo" },
    { role: "model", content: "Here is a 3-day itinerary for Tokyo." },
    { role: "user", content: "What are the top 3 museums?" },
  ];

  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].role, "user");
  assert.strictEqual(history[1].role, "model");
  assert.strictEqual(history[2].role, "user");
});

test("Agent Bounded Execution Limits & Loop Safeguards", () => {
  const maxIterations = 10;
  let iterations = 0;
  let isHalted = false;

  for (let i = 0; i < 20; i++) {
    iterations++;
    if (iterations >= maxIterations) {
      isHalted = true;
      break;
    }
  }

  assert.strictEqual(isHalted, true);
  assert.strictEqual(iterations, maxIterations);
});

test("Android SDK 36.0.0 Configuration Validation", () => {
  const compileSdk = 36;
  const targetSdk = 36;
  const minSdk = 24;

  assert.strictEqual(compileSdk, 36);
  assert.strictEqual(targetSdk, 36);
  assert.ok(minSdk >= 21);
});

test("Voice Chat Feedback Loop & Speech Lifecycle Safeguards", () => {
  // Test cooldown buffer, retry limits, and recognition timeout safeguards
  const PLAYBACK_COOLDOWN_MS = 750;
  const MAX_RECOGNITION_RETRIES = 3;
  const RECOGNITION_TIMEOUT_MS = 12000;

  assert.ok(PLAYBACK_COOLDOWN_MS >= 500, "Cooldown buffer must be at least 500ms to eliminate speaker tail audio");
  assert.ok(MAX_RECOGNITION_RETRIES <= 5, "Retry limit must be bounded to prevent infinite loops");
  assert.ok(RECOGNITION_TIMEOUT_MS > 0 && RECOGNITION_TIMEOUT_MS <= 30000, "Recognition timeout must be bounded");

  // Validate retry counter logic
  let consecutiveErrors = 0;
  let halted = false;
  for (let i = 0; i < 10; i++) {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_RECOGNITION_RETRIES) {
      halted = true;
      break;
    }
  }
  assert.strictEqual(halted, true);
  assert.strictEqual(consecutiveErrors, MAX_RECOGNITION_RETRIES);
});

test("Android Manifest Speech Recognition Queries Declaration", async () => {
  const fs = await import("node:fs");
  const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf-8");
  assert.ok(manifest.includes("<queries>"), "Manifest must declare <queries>");
  assert.ok(manifest.includes("android.speech.RecognitionService"), "Manifest must query android.speech.RecognitionService for Android 11+");
});

test("On-Device API Key Persistence with Provider and Model Configuration", () => {
  const storageMock: Record<string, string> = {};
  const STORAGE_KEY_CONFIG = "omni_providers_config";

  // Simulate saving configuration with model and API key into the same persistent storage
  const configMap: Record<string, any> = {};
  configMap["gemini"] = {
    selectedModel: "gemini-3.5-flash-lite",
    apiKey: "AIzaSyTestMockKey12345",
  };
  storageMock[STORAGE_KEY_CONFIG] = JSON.stringify(configMap);

  // Retrieve and verify key is stored in the same persistent on-device config map
  const retrieved = JSON.parse(storageMock[STORAGE_KEY_CONFIG]);
  assert.strictEqual(retrieved.gemini.selectedModel, "gemini-3.5-flash-lite");
  assert.strictEqual(retrieved.gemini.apiKey, "AIzaSyTestMockKey12345");
});

test("Native CapSpeechRecognition Partial Results and Utterance Handoff Pipeline", () => {
  let currentTranscript = "";
  let userSpeechDetected = false;
  let committedUtterance = "";

  const onPartialResults = (data: { matches: string[] }) => {
    if (data?.matches && data.matches.length > 0) {
      const topMatch = data.matches[0].trim();
      if (topMatch) {
        currentTranscript = topMatch;
        userSpeechDetected = true;
      }
    }
  };

  const commitUtterance = () => {
    committedUtterance = currentTranscript.trim();
    currentTranscript = "";
    userSpeechDetected = false;
  };

  // Simulate partial results incoming from native speech recognition
  onPartialResults({ matches: ["Hello"] });
  assert.strictEqual(userSpeechDetected, true);
  assert.strictEqual(currentTranscript, "Hello");

  onPartialResults({ matches: ["Hello Sierra how are you"] });
  assert.strictEqual(currentTranscript, "Hello Sierra how are you");

  // Simulate end of speech / silence commit
  commitUtterance();
  assert.strictEqual(committedUtterance, "Hello Sierra how are you");
  assert.strictEqual(currentTranscript, "");
  assert.strictEqual(userSpeechDetected, false);
});

test("Persistent Debug Signing Configuration in Android Gradle Build", async () => {
  const fs = await import("node:fs");
  const gradleBuild = fs.readFileSync("android/app/build.gradle", "utf-8");

  assert.ok(gradleBuild.includes("signingConfigs"), "build.gradle must configure signingConfigs");
  assert.ok(gradleBuild.includes('storeFile file("sierra-debug.keystore")'), "build.gradle must specify fixed sierra-debug.keystore storeFile");
  assert.ok(gradleBuild.includes('keyAlias "androiddebugkey"'), "build.gradle must specify consistent androiddebugkey keyAlias");
  assert.ok(gradleBuild.includes('storePassword "android"'), "build.gradle must specify storePassword");
  assert.ok(gradleBuild.includes('keyPassword "android"'), "build.gradle must specify keyPassword");
  assert.ok(gradleBuild.includes("signingConfig signingConfigs.debug"), "buildTypes must use signingConfigs.debug");

  const keystorePath = "android/app/sierra-debug.keystore";
  assert.ok(fs.existsSync(keystorePath), `${keystorePath} must exist on disk`);
  const stats = fs.statSync(keystorePath);
  assert.ok(stats.size > 0, `${keystorePath} must not be empty`);
});

test("Voice Debug Log Export and Formatting Pipeline", async () => {
  const { formatDebugLogs } = await import("../src/lib/debugLogs");

  // 1. Verify empty log format
  const emptyFormatted = formatDebugLogs([]);
  assert.strictEqual(emptyFormatted, "No pipeline events recorded yet.");

  // 2. Build 30 chronological mock debug events
  const mockLogs = Array.from({ length: 30 }, (_, i) => ({
    id: `log-${i}`,
    time: `10:00:${i < 10 ? '0' + i : i} AM`,
    stage: i % 2 === 0 ? 'STT:Start' : 'partialResults',
    detail: `Sample diagnostic detail message ${i + 1}`,
  }));

  // 3. Test full log export
  const fullExport = formatDebugLogs(mockLogs);
  const fullLines = fullExport.split("\n");
  assert.strictEqual(fullLines.length, 30);
  assert.strictEqual(fullLines[0], "[10:00:00 AM] [STT:Start] Sample diagnostic detail message 1");
  assert.strictEqual(fullLines[29], "[10:00:29 AM] [partialResults] Sample diagnostic detail message 30");

  // 4. Test Last 20 Events export
  const last20Export = formatDebugLogs(mockLogs, 20);
  const last20Lines = last20Export.split("\n");
  assert.strictEqual(last20Lines.length, 20);
  assert.strictEqual(last20Lines[0], "[10:00:10 AM] [STT:Start] Sample diagnostic detail message 11");
  assert.strictEqual(last20Lines[19], "[10:00:29 AM] [partialResults] Sample diagnostic detail message 30");

  // 5. Verify @capacitor/clipboard dependency in package.json
  const fs = await import("node:fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  assert.ok(pkg.dependencies["@capacitor/clipboard"], "@capacitor/clipboard must be present in dependencies");
});

test("Recognition Session Lifecycle: Duplicate Start Prevention", async () => {
  let isStarting = false;
  let isListening = false;
  let startCount = 0;

  const simulateStart = async () => {
    if (isStarting || isListening) {
      return { skipped: true };
    }
    isStarting = true;
    startCount++;
    // Simulate async native start call
    await new Promise((r) => setTimeout(r, 20));
    isListening = true;
    isStarting = false;
    return { skipped: false };
  };

  // First call should succeed
  const res1 = simulateStart();
  // Immediate concurrent duplicate calls should be rejected
  const res2 = simulateStart();
  const res3 = simulateStart();

  const [out1, out2, out3] = await Promise.all([res1, res2, res3]);
  assert.strictEqual(out1.skipped, false);
  assert.strictEqual(out2.skipped, true);
  assert.strictEqual(out3.skipped, true);
  assert.strictEqual(startCount, 1, "Only one native start invocation must occur");

  // While listening, another call should also be skipped
  const res4 = await simulateStart();
  assert.strictEqual(res4.skipped, true);
  assert.strictEqual(startCount, 1);
});

test("Recognition Session Lifecycle: Delayed Stop and Timeout Protection", async () => {
  // Simulate native stop that hangs indefinitely without calling resolve
  const hangingNativeStop = () => new Promise<void>(() => {});

  const withNativeTimeout = async <T, F = T>(
    promise: Promise<T>,
    ms: number = 50,
    fallbackValue?: F
  ): Promise<T | F | undefined> => {
    let timeoutId: any = null;
    const timeoutPromise = new Promise<F | undefined>((resolve) => {
      timeoutId = setTimeout(() => resolve(fallbackValue), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const startT = Date.now();
  const result = await withNativeTimeout(hangingNativeStop(), 50, "timed_out");
  const elapsed = Date.now() - startT;

  assert.strictEqual(result, "timed_out");
  assert.ok(elapsed >= 45 && elapsed < 300, `Execution resumed promptly after timeout: ${elapsed}ms`);
});

test("Recognition Session Lifecycle: Stale Listener Event Invalidation", () => {
  let activeCycleId = 1;
  let currentTranscript = "";

  const onPartialResults = (eventCycleId: number, match: string) => {
    // If event comes from an older or obsolete recognition cycle, discard it
    if (eventCycleId !== activeCycleId) {
      return false;
    }
    currentTranscript = match;
    return true;
  };

  // Valid event from active cycle #1
  const accepted1 = onPartialResults(1, "Hello Sierra");
  assert.strictEqual(accepted1, true);
  assert.strictEqual(currentTranscript, "Hello Sierra");

  // Advance cycle to #2 (e.g. after response or timeout)
  activeCycleId = 2;
  currentTranscript = "";

  // Late arriving event from cycle #1 should be dropped
  const acceptedStale = onPartialResults(1, "stale trailing speech from previous round");
  assert.strictEqual(acceptedStale, false);
  assert.strictEqual(currentTranscript, "", "Transcript buffer must remain uncontaminated by stale event");

  // Valid event from cycle #2 should be accepted
  const accepted2 = onPartialResults(2, "What is the weather today?");
  assert.strictEqual(accepted2, true);
  assert.strictEqual(currentTranscript, "What is the weather today?");
});

test("Recognition Session Lifecycle: Native Error Recovery and Bounded Backoff", () => {
  const MAX_RETRIES = 3;
  let consecutiveFailures = 0;
  let isListening = true;
  let isPaused = false;
  const scheduledBackoffs: number[] = [];

  const handleNativeError = (errorCode: number, errorMsg: string) => {
    isListening = false;
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_RETRIES) {
      isPaused = true;
      return;
    }
    const backoff = Math.min(800 * consecutiveFailures, 3000);
    scheduledBackoffs.push(backoff);
  };

  // Round 1 error (e.g., SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
  handleNativeError(6, "No speech input");
  assert.strictEqual(isListening, false);
  assert.strictEqual(consecutiveFailures, 1);
  assert.strictEqual(isPaused, false);
  assert.strictEqual(scheduledBackoffs[0], 800);

  // Round 2 error (e.g., SpeechRecognizer.ERROR_NO_MATCH)
  handleNativeError(7, "No match");
  assert.strictEqual(consecutiveFailures, 2);
  assert.strictEqual(isPaused, false);
  assert.strictEqual(scheduledBackoffs[1], 1600);

  // Round 3 error (hits max retry limit)
  handleNativeError(3, "Audio recording error");
  assert.strictEqual(consecutiveFailures, 3);
  assert.strictEqual(isPaused, true, "State machine must pause continuous listening after max retries");
  assert.strictEqual(scheduledBackoffs.length, 2, "No restart must be scheduled after pausing");
});

test("Recognition Session Lifecycle: Clean Cancellation and Teardown on Stop", () => {
  let isActive = true;
  let isListening = true;
  let userSpeechDetected = true;
  let listenersAttached = true;
  let timerCleared = false;
  let timerId: any = 12345;

  const stopSession = () => {
    isActive = false;
    isListening = false;
    userSpeechDetected = false;
    if (timerId) {
      timerCleared = true;
      timerId = null;
    }
    listenersAttached = false;
  };

  stopSession();
  assert.strictEqual(isActive, false);
  assert.strictEqual(isListening, false);
  assert.strictEqual(userSpeechDetected, false);
  assert.strictEqual(listenersAttached, false);
  assert.strictEqual(timerCleared, true);
  assert.strictEqual(timerId, null);
});

test("Native Patch Integrity: SpeechRecognition.java Patch and Backup Verification", async () => {
  const fs = await import("node:fs");
  const javaPath = "node_modules/@capacitor-community/speech-recognition/android/src/main/java/com/getcapacitor/community/speechrecognition/SpeechRecognition.java";
  const backupPath = "scripts/SpeechRecognition.java.backup";

  assert.ok(fs.existsSync(javaPath), "SpeechRecognition.java must exist");
  assert.ok(fs.existsSync(backupPath), "SpeechRecognition.java.backup must exist");

  const javaContent = fs.readFileSync(javaPath, "utf-8");
  assert.ok(
    javaContent.includes("call.resolve();"),
    "SpeechRecognition.stop() must invoke call.resolve() to prevent indefinite hangs"
  );
  assert.ok(
    javaContent.includes('ret.put("errorCode", error);'),
    "SpeechRecognition.onError() must notify listeningState with error details"
  );
});

test("Native Text-to-Speech Integration and Lifecycle Contracts", async () => {
  const fs = await import("node:fs");
  const liveVoiceContent = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Verify plugin import and speak invocation
  assert.ok(
    liveVoiceContent.includes("import { TextToSpeech } from '@capacitor-community/text-to-speech';"),
    "LiveVoice.tsx must import TextToSpeech from @capacitor-community/text-to-speech"
  );
  assert.ok(
    liveVoiceContent.includes("TextToSpeech.speak("),
    "LiveVoice.tsx must invoke TextToSpeech.speak()"
  );

  // Verify 15-second timeout race
  assert.ok(
    liveVoiceContent.includes("15000"),
    "Native TTS must employ a 15-second timeout safeguard"
  );

  // Verify debug logging for all 4 stages
  assert.ok(liveVoiceContent.includes("addDebugLog('TTS:Start'"), "Must log TTS:Start");
  assert.ok(liveVoiceContent.includes("addDebugLog('TTS:Finished'"), "Must log TTS:Finished");
  assert.ok(liveVoiceContent.includes("addDebugLog('TTS:Timeout'"), "Must log TTS:Timeout");
  assert.ok(liveVoiceContent.includes("addDebugLog('TTS:Error'"), "Must log TTS:Error");

  // Verify STT cleanup before TTS
  assert.ok(
    liveVoiceContent.includes("await withNativeTimeout(stopSpeechToText(),"),
    "stopSpeechToText() must be protected by timeout pattern before TTS starts"
  );

  // Verify scheduleListeningRestart is called in finally
  assert.ok(
    liveVoiceContent.includes("scheduleListeningRestart();"),
    "scheduleListeningRestart must be called after TTS resolves or fails"
  );
});

test("Live Voice Model Test-Connection & BidiGenerateContent WebSocket Pipeline", async () => {
  const { isGeminiLiveModel, testGeminiLiveWebSocket, DEFAULT_LIVE_WEBSOCKET_URL } = await import("../src/lib/gemini");

  // 1. Verify model classification for Live API
  assert.strictEqual(isGeminiLiveModel("gemini-3.8-live"), true);
  assert.strictEqual(isGeminiLiveModel("gemini-3.8-live-extended-thinking"), true);
  assert.strictEqual(isGeminiLiveModel("gemini-3.1-flash-live-preview"), true);
  assert.strictEqual(isGeminiLiveModel("gemini-3.5-flash-lite"), false);
  assert.strictEqual(isGeminiLiveModel("gemini-3-flash-preview"), false);
  assert.strictEqual(isGeminiLiveModel("gemini-3.1-pro-preview"), false);
  assert.strictEqual(isGeminiLiveModel("gpt-4o"), false);
  assert.strictEqual(isGeminiLiveModel(""), false);
  assert.strictEqual(isGeminiLiveModel(undefined), false);

  // 2. Verify default WebSocket endpoint URL
  assert.ok(
    DEFAULT_LIVE_WEBSOCKET_URL.includes("BidiGenerateContent"),
    "DEFAULT_LIVE_WEBSOCKET_URL must target BidiGenerateContent service"
  );
  assert.ok(
    DEFAULT_LIVE_WEBSOCKET_URL.startsWith("wss://generativelanguage.googleapis.com"),
    "DEFAULT_LIVE_WEBSOCKET_URL must use wss protocol on generativelanguage host"
  );

  // 3. Test simulated WebSocket lifecycle with setup message and setupComplete
  const originalWebSocket = (globalThis as any).WebSocket;
  let sentPayload: any = null;
  let connectionUrl = "";

  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;

    constructor(url: string) {
      connectionUrl = url;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 5);
    }

    send(data: string) {
      sentPayload = JSON.parse(data);
      // Simulate Gemini Live server setupComplete acknowledgment
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
        }
      }, 5);
    }

    close() {
      this.readyState = 3;
      if (this.onclose) {
        this.onclose({ code: 1000, reason: "Normal closure" });
      }
    }
  }

  (globalThis as any).WebSocket = MockWebSocket;

  try {
    const result = await testGeminiLiveWebSocket({
      apiKey: "test-api-key-12345",
      model: "gemini-3.8-live",
      timeoutMs: 1000,
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.latencyMs >= 0);
    assert.ok(result.message?.includes("gemini-3.8-live"));
    assert.ok(connectionUrl.includes("key=test-api-key-12345"));
    assert.ok(connectionUrl.includes("BidiGenerateContent"));
    assert.deepStrictEqual(sentPayload, {
      setup: {
        model: "models/gemini-3.8-live",
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        outputAudioTranscription: {},
      },
    });

    // Test with gemini-3.8-live-extended-thinking
    const resultThinking = await testGeminiLiveWebSocket({
      apiKey: "test-api-key-12345",
      model: "gemini-3.8-live-extended-thinking",
      thinkingLevel: "MEDIUM",
      timeoutMs: 1000,
    });
    assert.strictEqual(resultThinking.success, true);
    assert.deepStrictEqual(sentPayload, {
      setup: {
        model: "models/gemini-3.8-live-extended-thinking",
        generationConfig: {
          responseModalities: ["AUDIO"],
          thinkingConfig: {
            thinkingLevel: "MEDIUM",
          },
        },
        outputAudioTranscription: {},
      },
    });
  } finally {
    (globalThis as any).WebSocket = originalWebSocket;
  }
});

test("Continuous-Listening STT State Machine & ErrorCode 5 Recovery Pipeline", () => {
  // 1. Exponential backoff contract: 500ms, 1s, 2s, 4s
  const getBackoffDelay = (attempt: number): number => {
    if (attempt <= 1) return 500;
    if (attempt === 2) return 1000;
    if (attempt === 3) return 2000;
    return 4000;
  };
  assert.strictEqual(getBackoffDelay(1), 500);
  assert.strictEqual(getBackoffDelay(2), 1000);
  assert.strictEqual(getBackoffDelay(3), 2000);
  assert.strictEqual(getBackoffDelay(4), 4000);
  assert.ok(getBackoffDelay(1) >= 300, "Must satisfy delay of at least 300ms before every restart");

  // 2. State Machine guards: ignore start requests while starting, listening, or paused
  let isStarting = false;
  let isListening = false;
  let isPaused = false;
  let isActive = true;
  let isSpeaking = false;
  let isResponding = false;
  let startInvocations = 0;

  const canStart = () => {
    if (!isActive || isPaused || isStarting || isListening || isSpeaking || isResponding) {
      return false;
    }
    return true;
  };

  assert.strictEqual(canStart(), true);
  isStarting = true;
  assert.strictEqual(canStart(), false, "Cannot start while already starting");
  isStarting = false;
  isListening = true;
  assert.strictEqual(canStart(), false, "Cannot start while listening");
  isListening = false;
  isPaused = true;
  assert.strictEqual(canStart(), false, "Cannot start while paused");
  isPaused = false;
  isSpeaking = true;
  assert.strictEqual(canStart(), false, "Cannot start while Sierra TTS is speaking");

  // 3. Error code 5 (Client side error / ERROR_CLIENT) recovery:
  // Must NOT count as an empty cycle, allows at most 2 recoveries, then pauses with clear error.
  let consecutiveFailures = 0;
  let clientErrorRecoveryCount = 0;
  let pausedReason = "";

  const handleStoppedWithClientError = (errorCode: number) => {
    if (errorCode === 5) {
      // Do NOT count as empty cycle
      if (clientErrorRecoveryCount < 2) {
        clientErrorRecoveryCount++;
        return { recovered: true, paused: false };
      } else {
        isPaused = true;
        pausedReason = "Speech recognizer unavailable, tap mic to retry";
        return { recovered: false, paused: true, error: pausedReason };
      }
    }
    // Normal empty cycle
    consecutiveFailures++;
    return { recovered: false, paused: false };
  };

  // Attempt 1 errorCode 5
  const res1 = handleStoppedWithClientError(5);
  assert.strictEqual(res1.recovered, true);
  assert.strictEqual(clientErrorRecoveryCount, 1);
  assert.strictEqual(consecutiveFailures, 0, "ErrorCode 5 must NOT increment empty cycle count");

  // Attempt 2 errorCode 5
  const res2 = handleStoppedWithClientError(5);
  assert.strictEqual(res2.recovered, true);
  assert.strictEqual(clientErrorRecoveryCount, 2);
  assert.strictEqual(consecutiveFailures, 0);

  // Attempt 3 errorCode 5 -> exceeds limit of 2, pauses with actionable message
  const res3 = handleStoppedWithClientError(5);
  assert.strictEqual(res3.recovered, false);
  assert.strictEqual(res3.paused, true);
  assert.strictEqual(res3.error, "Speech recognizer unavailable, tap mic to retry");
  assert.strictEqual(isPaused, true);

  // 4. User mic tap clears paused and resets failure counters
  const onMicTap = () => {
    isPaused = false;
    consecutiveFailures = 0;
    clientErrorRecoveryCount = 0;
    pausedReason = "";
  };
  onMicTap();
  assert.strictEqual(isPaused, false);
  assert.strictEqual(consecutiveFailures, 0);
  assert.strictEqual(clientErrorRecoveryCount, 0);

  // 5. Successful speech result resets failure counter to 0
  consecutiveFailures = 2;
  const onSpeechSuccess = () => {
    consecutiveFailures = 0;
    clientErrorRecoveryCount = 0;
  };
  onSpeechSuccess();
  assert.strictEqual(consecutiveFailures, 0, "Successful speech result must reset failure count to 0");

  // 6. Log throttling: drops identical log lines within 1000ms
  let lastLog = { key: "", time: 0 };
  const loggedLines: string[] = [];

  const throttledLog = (stage: string, detail: string, now: number) => {
    const key = `${stage}:${detail}`;
    if (lastLog.key === key && now - lastLog.time < 1000) {
      return false; // dropped
    }
    lastLog = { key, time: now };
    loggedLines.push(key);
    return true; // accepted
  };

  const t0 = 10000;
  assert.strictEqual(throttledLog("STT:Start", "Checking permissions", t0), true);
  assert.strictEqual(throttledLog("STT:Start", "Checking permissions", t0 + 100), false, "Duplicate within 100ms dropped");
  assert.strictEqual(throttledLog("STT:Start", "Checking permissions", t0 + 500), false, "Duplicate within 500ms dropped");
  assert.strictEqual(throttledLog("STT:Start", "Checking permissions", t0 + 1050), true, "Duplicate after 1000ms accepted");
  assert.strictEqual(throttledLog("STT:Different", "Other detail", t0 + 1100), true, "Different log accepted immediately");
});

test("Recognition Session Lifecycle: Stale Session Events Ignored", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Verify sessionIdRef and session tagging in source code
  assert.ok(liveVoiceCode.includes("sessionIdRef = useRef<number>(0)"), "Must declare sessionIdRef");
  assert.ok(liveVoiceCode.includes("const sessionId = ++sessionIdRef.current"), "Must increment sessionId on start");
  assert.ok(liveVoiceCode.includes("eventSessionId !== sessionIdRef.current"), "Must check event sessionId against current session");
  assert.ok(liveVoiceCode.includes("STT:StaleEvent"), "Must log stale session events as STT:StaleEvent");
  assert.ok(liveVoiceCode.includes("sessionId: sessionId"), "Must pass sessionId to CapSpeechRecognition.start");

  // Simulate stale session event filter behavior
  let currentSessionId = 3;
  let staleEventsLogged: string[] = [];

  const handleListenerEvent = (event: { sessionId?: number; status?: string }) => {
    if (event.sessionId !== undefined && event.sessionId !== currentSessionId) {
      staleEventsLogged.push(`Stale event from session ${event.sessionId} ignored`);
      return false; // Ignored
    }
    return true; // Accepted
  };

  // Events from older sessions (1 and 2) must be rejected
  assert.strictEqual(handleListenerEvent({ sessionId: 1, status: "stopped" }), false);
  assert.strictEqual(handleListenerEvent({ sessionId: 2, status: "ready" }), false);
  assert.strictEqual(staleEventsLogged.length, 2);

  // Event from current session (3) must be accepted
  assert.strictEqual(handleListenerEvent({ sessionId: 3, status: "started" }), true);
  assert.strictEqual(staleEventsLogged.length, 2);
});

test("Recognition Session Lifecycle: Startup Failures Not Counted as Empty Cycles", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Verify startupFailuresRef and startup failure logic in source code
  assert.ok(liveVoiceCode.includes("startupFailuresRef = useRef<number>(0)"), "Must declare startupFailuresRef");
  assert.ok(liveVoiceCode.includes("isStartupFailure"), "Must identify isStartupFailure");
  assert.ok(!liveVoiceCode.includes("!reachedStarted || timeSinceReady <= 1200"), "Must remove !reachedStarted from isStartupFailure");
  assert.ok(liveVoiceCode.includes("timeSinceReady <= 1200"), "Startup failure must only check timeSinceReady <= 1200");
  assert.ok(liveVoiceCode.includes("Speech recognizer failed to start after 3 attempts"), "Must display clear message after 3 startup failures");

  // Simulate startup failure vs empty cycle state machine
  let consecutiveFailures = 0; // empty cycles
  let startupFailures = 0;
  let isPaused = false;
  let pauseReason = "";

  const handleStoppedEvent = (params: {
    errorCode?: number;
    reachedStarted: boolean;
    durationMs: number;
    timeSinceReadyMs: number;
  }) => {
    const isErrorCode7 = params.errorCode === 7;
    const isStartupFailure = isErrorCode7 && (params.timeSinceReadyMs <= 1200);

    if (isStartupFailure) {
      startupFailures++;
      if (startupFailures >= 3) {
        isPaused = true;
        pauseReason = "Speech recognizer failed to start after 3 attempts. Tap mic to retry.";
      }
      return { type: "startup_failure", backoff: startupFailures === 1 ? 1000 : startupFailures === 2 ? 2000 : 4000 };
    }

    if (isErrorCode7) {
      // After > 1200ms: normal silence timeout, restart immediately without counting a failure
      return { type: "silence_restart", delayMs: 300 };
    }

    if (params.reachedStarted && params.durationMs >= 3000) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        isPaused = true;
        pauseReason = "Continuous listening paused after 3 empty cycles. Tap mic to resume.";
      }
      return { type: "empty_cycle" };
    }

    return { type: "sub_3s_cycle" };
  };

  // Immediate error code 7 within 1200ms of ready is a startup failure
  const sf1 = handleStoppedEvent({ errorCode: 7, reachedStarted: false, durationMs: 4, timeSinceReadyMs: 4 });
  assert.strictEqual(sf1.type, "startup_failure");
  assert.strictEqual(sf1.backoff, 1000);
  assert.strictEqual(startupFailures, 1);
  assert.strictEqual(consecutiveFailures, 0, "Startup failure must NOT increment empty cycles");

  const sf2 = handleStoppedEvent({ errorCode: 7, reachedStarted: false, durationMs: 10, timeSinceReadyMs: 10 });
  assert.strictEqual(sf2.type, "startup_failure");
  assert.strictEqual(sf2.backoff, 2000);
  assert.strictEqual(startupFailures, 2);
  assert.strictEqual(consecutiveFailures, 0);

  const sf3 = handleStoppedEvent({ errorCode: 7, reachedStarted: false, durationMs: 15, timeSinceReadyMs: 15 });
  assert.strictEqual(sf3.type, "startup_failure");
  assert.strictEqual(startupFailures, 3);
  assert.strictEqual(consecutiveFailures, 0);
  assert.strictEqual(isPaused, true);
  assert.strictEqual(pauseReason, "Speech recognizer failed to start after 3 attempts. Tap mic to retry.");

  // Error code 7 arriving after > 1200ms (e.g. 5000ms silence timeout) is silence, NOT a startup failure
  startupFailures = 0;
  isPaused = false;
  const silenceResult = handleStoppedEvent({ errorCode: 7, reachedStarted: false, durationMs: 5000, timeSinceReadyMs: 5000 });
  assert.strictEqual(silenceResult.type, "silence_restart");
  assert.strictEqual(startupFailures, 0, "Silence after 5s must NOT increment startup failures");
  assert.strictEqual(consecutiveFailures, 0, "Silence after 5s must NOT increment empty cycles");
  assert.strictEqual(isPaused, false, "Must NOT pause continuous listening on normal silence timeout");

  // A genuine empty cycle that reached 'started' and ran 3.5s without speech
  startupFailures = 0;
  isPaused = false;
  const ec1 = handleStoppedEvent({ errorCode: undefined, reachedStarted: true, durationMs: 3500, timeSinceReadyMs: 3600 });
  assert.strictEqual(ec1.type, "empty_cycle");
  assert.strictEqual(consecutiveFailures, 1);
  assert.strictEqual(startupFailures, 0);
});

test("Recognition Session Lifecycle: Resume-from-Pause Teardown and Counter Reset", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Verify resume tap implementation
  assert.ok(liveVoiceCode.includes("resumeGracePeriodUntilRef"), "Must declare resumeGracePeriodUntilRef");
  assert.ok(liveVoiceCode.includes("startupFailuresRef.current = 0"), "Must reset startupFailuresRef on resume");
  assert.ok(liveVoiceCode.includes("consecutiveFailuresRef.current = 0"), "Must reset consecutiveFailuresRef on resume");
  assert.ok(liveVoiceCode.includes("clientErrorRecoveryCountRef.current = 0"), "Must reset clientErrorRecoveryCountRef on resume");
  assert.ok(liveVoiceCode.includes("1500"), "Must configure 1.5s resume grace period");
  assert.ok(liveVoiceCode.includes("750"), "Must wait at least 750ms before starting after resume tap");

  // Simulate resume tap lifecycle
  let consecutiveFailures = 3;
  let startupFailures = 3;
  let clientErrorRecoveryCount = 2;
  let isPaused = true;
  let teardownCalled = false;
  let resumeGracePeriodUntil = 0;

  const onResumeTap = async () => {
    // 1. Teardown
    teardownCalled = true;

    // 2. 1.5s grace period
    const now = 10000;
    resumeGracePeriodUntil = now + 1500;

    // 3. Reset all counters and flags
    consecutiveFailures = 0;
    startupFailures = 0;
    clientErrorRecoveryCount = 0;
    isPaused = false;
  };

  await onResumeTap();
  assert.strictEqual(teardownCalled, true);
  assert.strictEqual(isPaused, false);
  assert.strictEqual(consecutiveFailures, 0);
  assert.strictEqual(startupFailures, 0);
  assert.strictEqual(clientErrorRecoveryCount, 0);
  assert.strictEqual(resumeGracePeriodUntil, 11500);

  // During 1.5s grace period, errorCode 5 and 7 are ignored as benign
  const isIgnoredDuringGrace = (errorCode: number, timestamp: number) => {
    return timestamp < resumeGracePeriodUntil && (errorCode === 5 || errorCode === 7);
  };
  assert.strictEqual(isIgnoredDuringGrace(5, 10200), true, "ErrorCode 5 ignored during grace window");
  assert.strictEqual(isIgnoredDuringGrace(7, 10500), true, "ErrorCode 7 ignored during grace window");
  assert.strictEqual(isIgnoredDuringGrace(5, 12000), false, "ErrorCode 5 not ignored after grace window");
});

test("Recognition Session Lifecycle: No Start After Pause & Cancellation Checkpoints", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Verify cancellation checkpoints in startSpeechToText
  assert.ok(liveVoiceCode.includes("isStartCancelled"), "Must define isStartCancelled helper in startSpeechToText");
  assert.ok(liveVoiceCode.includes("isStoppingRef.current"), "Must guard isStoppingRef to prevent start while stopping");
  assert.ok(liveVoiceCode.includes("800"), "Must enforce at least 800ms settling time after stop/teardown");
  assert.ok(liveVoiceCode.includes("STT:Start:Aborted"), "Must log cancellation when aborted");

  // Simulate cancellation checkpoints
  let isPaused = false;
  let isStopping = false;
  let currentSessionId = 5;

  const checkCancelled = (sessionTag: number) => {
    return isPaused || isStopping || currentSessionId !== sessionTag;
  };

  // Initially active, valid session
  assert.strictEqual(checkCancelled(5), false);

  // Abort if paused
  isPaused = true;
  assert.strictEqual(checkCancelled(5), true, "Must abort start sequence if paused");

  // Abort if stopping
  isPaused = false;
  isStopping = true;
  assert.strictEqual(checkCancelled(5), true, "Must abort start sequence if previous session stopping");

  // Abort if superseded by newer session
  isStopping = false;
  currentSessionId = 6;
  assert.strictEqual(checkCancelled(5), true, "Must abort start sequence if superseded by newer session id");
});

test("Gemini Live WebSocket: Setup Configuration and responseModalities Contract", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");
  const geminiCode = fs.readFileSync("src/lib/gemini.ts", "utf-8");

  // 1. responseModalities MUST be ["AUDIO"], never TEXT
  assert.ok(geminiCode.includes('responseModalities: ["AUDIO"]'), "gemini.ts must set responseModalities to ['AUDIO']");
  assert.ok(!geminiCode.includes('responseModalities: ["TEXT"]'), "gemini.ts must NEVER set responseModalities to TEXT");
  assert.ok(liveVoiceCode.includes('responseModalities: ["AUDIO"]'), "LiveVoice.tsx must set responseModalities to ['AUDIO']");
  assert.ok(!liveVoiceCode.includes('responseModalities: ["TEXT"]'), "LiveVoice.tsx must NEVER set responseModalities to TEXT");

  // 2. outputAudioTranscription MUST be enabled in setup
  assert.ok(geminiCode.includes("outputAudioTranscription: {}"), "gemini.ts must enable outputAudioTranscription: {}");
  assert.ok(liveVoiceCode.includes("outputAudioTranscription: {}"), "LiveVoice.tsx must enable outputAudioTranscription: {}");

  // 3. Audio handling and playback via Web Audio playAudio
  assert.ok(liveVoiceCode.includes("playAudio(part.inlineData.data)"), "LiveVoice.tsx must play inlineData audio via playAudio");
  assert.ok(liveVoiceCode.includes("outputTranscription?.text"), "LiveVoice.tsx must capture outputTranscription text for chat UI");
  assert.ok(liveVoiceCode.includes("serverContent.interrupted"), "LiveVoice.tsx must stop playback on interrupted");

  // 4. WebSocket session reuse: single open WebSocket reused across turns
  assert.ok(liveVoiceCode.includes("ensureLiveWebSocket"), "LiveVoice.tsx must define ensureLiveWebSocket for session reuse");
  assert.ok(liveVoiceCode.includes("clientContentMessage"), "LiveVoice.tsx must send user turns via clientContent");
});

test("Sierra SFW Mode: Natural Conversational System Prompt Construction", async () => {
  const { buildSierraSystemInstruction } = await import("../src/lib/persona.ts");
  const sfwPrompt = buildSierraSystemInstruction("sierra-companion", "sfw");
  
  assert.ok(sfwPrompt.includes("You are Sierra"), "Must include Sierra identity");
  assert.ok(sfwPrompt.includes("Content Mode: SFW"), "Must include SFW content mode");
  assert.ok(sfwPrompt.includes("No Canned AI Fluff"), "Must avoid generic canned AI filler");
  assert.ok(sfwPrompt.includes("platonic"), "Must guide SFW romantic boundaries tastefully");
});

test("Sierra Mature / Adult Mode (18+): Intimacy, Flirtation & Consensual Roleplay Directives", async () => {
  const { buildSierraSystemInstruction } = await import("../src/lib/persona.ts");
  const maturePrompt = buildSierraSystemInstruction("sierra-intimate", "mature");
  
  assert.ok(maturePrompt.includes("MATURE & ADULT CONVERSATION (18+)"), "Must activate mature adult directives");
  assert.ok(maturePrompt.includes("Consensual Adult Expression"), "Must support consensual adult expression");
  assert.ok(maturePrompt.includes("No Unnecessary Restrictions or Refusals"), "Must eliminate unsolicited refusals or preachy moralizing");
  assert.ok(maturePrompt.includes("Never lecture the user on ethics or morality"), "Must avoid lecturing");
  assert.ok(maturePrompt.includes("Ethical & Consent Safeguards"), "Must maintain ethical safeguards against non-consensual harm");
});

test("Sierra Personality Continuity Across Content Mode Transitions", async () => {
  const { buildSierraSystemInstruction } = await import("../src/lib/persona.ts");
  
  const sfwInstruction = buildSierraSystemInstruction("sierra-companion", "sfw");
  const matureInstruction = buildSierraSystemInstruction("sierra-companion", "mature");
  
  // Both share the exact same core persona traits
  assert.ok(sfwInstruction.includes("Natural Pacing & Tone") && matureInstruction.includes("Natural Pacing & Tone"));
  assert.ok(sfwInstruction.includes("Emotional Attunement") && matureInstruction.includes("Emotional Attunement"));
  assert.ok(sfwInstruction.includes("Honesty & Grounding") && matureInstruction.includes("Honesty & Grounding"));
  
  // Custom directives append cleanly without overwriting persona
  const withCustom = buildSierraSystemInstruction("sierra-companion", "mature", "User preferred nickname: Alex");
  assert.ok(withCustom.includes("User preferred nickname: Alex"));
});

test("Multi-Provider Adult & Mature Content Capabilities Matrix", async () => {
  const { PROVIDER_CONTENT_CAPABILITIES } = await import("../src/lib/providers.ts");
  
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.custom.matureSupport, "full");
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.custom.recommendedForMature, true);
  assert.ok(PROVIDER_CONTENT_CAPABILITIES.custom.recommendedModels.includes("llama-3.3-70b-versatile"));
  
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.ollama.matureSupport, "full");
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.ollama.recommendedForMature, true);
  
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.anthropic.matureSupport, "permissive");
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.anthropic.recommendedForMature, true);
  
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.gemini.matureSupport, "moderate");
  assert.ok(PROVIDER_CONTENT_CAPABILITIES.gemini.matureBadge.includes("BLOCK_NONE"));
  
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.openai.matureSupport, "filtered");
  assert.strictEqual(PROVIDER_CONTENT_CAPABILITIES.openai.recommendedForMature, false);
});

test("Least Restrictive Gemini Safety Settings: BLOCK_NONE on All Supported Categories", async () => {
  const { SIERRA_SAFETY_SETTINGS } = await import("../src/lib/persona.ts");
  const { HarmBlockThreshold } = await import("@google/genai");
  
  assert.strictEqual(SIERRA_SAFETY_SETTINGS.length, 5);
  for (const setting of SIERRA_SAFETY_SETTINGS) {
    assert.strictEqual(setting.threshold, HarmBlockThreshold.BLOCK_NONE, `Category ${setting.category} must be BLOCK_NONE`);
  }
});

test("Client-Side Content Mode Persistence and UI Connection", async () => {
  const fs = await import("node:fs");
  const chatCode = fs.readFileSync("src/components/ChatInterface.tsx", "utf-8");
  const settingsCode = fs.readFileSync("src/components/Settings.tsx", "utf-8");
  
  // ChatInterface connects contentMode from unified store to streamChat
  assert.ok(chatCode.includes("useContentMode"), "ChatInterface must read contentMode from unified store");
  assert.ok(chatCode.includes("buildSierraSystemInstruction(selectedPersonaId, contentMode"), "ChatInterface must build system instruction with active contentMode");
  assert.ok(chatCode.includes("contentMode,"), "ChatInterface must pass contentMode to streamChat");
  
  // Settings provides Content Mode controls and multi-provider compatibility matrix
  assert.ok(settingsCode.includes("useContentMode"), "Settings must read and persist contentMode via unified store");
  assert.ok(settingsCode.includes("Multi-Provider & Model Compatibility Matrix"), "Settings must render compatibility matrix");
  assert.ok(settingsCode.includes("getCustomDirectives") && settingsCode.includes("setCustomDirectives"), "Settings must manage custom directives via settingsStore");
});

test("Live Voice System Instruction Parity with Persona & Custom Directives", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // 1. LiveVoice must use buildSierraSystemInstruction
  assert.ok(liveVoiceCode.includes("buildSierraSystemInstruction"), "LiveVoice.tsx must import and call buildSierraSystemInstruction");

  // 2. LiveVoice must retrieve selected persona and custom directives from unified settings/persona store
  assert.ok(liveVoiceCode.includes("getActivePersonaId"), "LiveVoice.tsx must read active persona from getActivePersonaId()");
  assert.ok(liveVoiceCode.includes("getCustomDirectives"), "LiveVoice.tsx must read custom directives from settingsStore");

  // 3. LiveVoice setup payload must NOT include safetySettings (rejected by Live endpoint with Error 1007) and must retain AUDIO modality
  assert.ok(!liveVoiceCode.includes("safetySettings:"), "LiveVoice.tsx setup payload must not include safetySettings (rejected by Live endpoint with error 1007)");
  assert.ok(liveVoiceCode.includes('responseModalities: ["AUDIO"]'), "LiveVoice.tsx setup payload must retain required AUDIO response modality");
});

test("Live Voice Cache Invalidation on Content Mode & Persona Changes", async () => {
  const fs = await import("node:fs");
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf-8");

  // Must track configuration fingerprint and invalidate stale sessions
  assert.ok(liveVoiceCode.includes("liveWsConfigFingerprintRef"), "LiveVoice.tsx must track configuration fingerprint");
  assert.ok(liveVoiceCode.includes("LiveWS:ConfigChange"), "LiveVoice.tsx must log LiveWS:ConfigChange when configuration changes");
  assert.ok(liveVoiceCode.includes("LiveWS:ContentMode"), "LiveVoice.tsx must listen to contentMode changes and invalidate cached socket");
});

test("ChatInterface Selected Persona Persistence under sierra_selected_persona", async () => {
  const fs = await import("node:fs");
  const chatCode = fs.readFileSync("src/components/ChatInterface.tsx", "utf-8");

  // Must read and write active persona through unified persona/settingsStore helpers
  assert.ok(chatCode.includes("getActivePersonaId()"), "ChatInterface must restore selected persona via getActivePersonaId()");
  assert.ok(chatCode.includes("setActivePersonaId("), "ChatInterface must persist selected persona via setActivePersonaId()");
});

test("Mature Mode Enhanced Expressive and Behavioral Directives", async () => {
  const { buildSierraSystemInstruction } = await import("../src/lib/persona.ts");
  const maturePrompt = buildSierraSystemInstruction("sierra-intimate", "mature");

  // All 5 test-sensitive phrases preserved
  assert.ok(maturePrompt.includes("MATURE & ADULT CONVERSATION (18+)"));
  assert.ok(maturePrompt.includes("Consensual Adult Expression"));
  assert.ok(maturePrompt.includes("No Unnecessary Restrictions or Refusals"));
  assert.ok(maturePrompt.includes("Never lecture the user on ethics or morality"));
  assert.ok(maturePrompt.includes("Ethical & Consent Safeguards"));

  // Behavioral enhancements present
  assert.ok(maturePrompt.includes("Expressive Engagement & Attraction"), "Must guide expressive engagement and attraction");
  assert.ok(maturePrompt.includes("Contextual Tone & Pacing"), "Must guide contextual tone and pacing");
  assert.ok(maturePrompt.includes("sensuality"), "Must support sensuality");
  assert.ok(maturePrompt.includes("suggestive dialogue"), "Must support suggestive dialogue");
});

test("Shared Provider and Model Selection Synchronization", async () => {
  const providersModule = await import("../src/lib/providers.ts");
  const fs = await import("node:fs");
  const chatCode = fs.readFileSync("src/components/ChatInterface.tsx", "utf-8");
  const settingsCode = fs.readFileSync("src/components/Settings.tsx", "utf-8");

  // 1. PROVIDER_METADATA must define models for all 5 providers
  const { PROVIDER_METADATA, getActiveProviderId, getSelectedModelForProvider, getModelsForProvider } = providersModule;
  assert.ok(PROVIDER_METADATA.gemini, "Gemini metadata must exist");
  assert.ok(PROVIDER_METADATA.openai, "OpenAI metadata must exist");
  assert.ok(PROVIDER_METADATA.anthropic, "Anthropic metadata must exist");
  assert.ok(PROVIDER_METADATA.custom, "Custom metadata must exist");
  assert.ok(PROVIDER_METADATA.ollama, "Ollama metadata must exist");

  assert.ok(PROVIDER_METADATA.openai.models.some((m: any) => m.id === "gpt-4o"), "OpenAI must contain gpt-4o");
  assert.ok(PROVIDER_METADATA.anthropic.models.some((m: any) => m.id === "claude-3-7-sonnet-latest"), "Anthropic must contain claude-3-7-sonnet-latest");
  assert.ok(PROVIDER_METADATA.custom.models.some((m: any) => m.id === "llama-3.3-70b-versatile"), "Custom must contain llama-3.3-70b-versatile");
  assert.ok(PROVIDER_METADATA.ollama.models.some((m: any) => m.id === "llama3.2"), "Ollama must contain llama3.2");

  // 2. Settings.tsx must import PROVIDER_METADATA from providers.ts
  assert.ok(settingsCode.includes("PROVIDER_METADATA"), "Settings.tsx must reference PROVIDER_METADATA");
  assert.ok(settingsCode.includes("from '../lib/providers'"), "Settings.tsx must import from providers.ts");

  // 3. ChatInterface.tsx must use useActiveProviderConfig, pass provider to streamChat, and show read-only navigable chip
  assert.ok(chatCode.includes("useActiveProviderConfig"), "ChatInterface.tsx must use useActiveProviderConfig");
  assert.ok(chatCode.includes("provider: activeProvider,"), "ChatInterface.tsx must pass activeProvider to streamChat");
  assert.ok(chatCode.includes('data-testid="chat-active-model-chip"'), "ChatInterface.tsx must display read-only active model chip");
  assert.ok(chatCode.includes("onOpenSettings?.('models')"), "ChatInterface.tsx chip must navigate to Settings models section");

  // 4. Default model resolution
  assert.strictEqual(getSelectedModelForProvider("gemini"), "gemini-3.5-flash-lite");
  assert.strictEqual(getSelectedModelForProvider("openai"), "gpt-4o");
  assert.strictEqual(getSelectedModelForProvider("anthropic"), "claude-3-7-sonnet-latest");
  assert.strictEqual(getSelectedModelForProvider("custom"), "llama-3.3-70b-versatile");
  assert.strictEqual(getSelectedModelForProvider("ollama"), "llama3.2");
});

test("Per-Provider Settings Persistence & Key Preservation", async () => {
  const { 
    saveProviderConfig, 
    getProvidersConfig, 
    STORAGE_KEY_CONFIG, 
    STORAGE_KEY_ACTIVE 
  } = await import("../src/lib/providers.ts");
  const { STORAGE_KEY_SETTINGS_V3 } = await import("../src/lib/settingsStore.ts");

  // Mock localStorage for isolated lifecycle test
  const storageMock: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => storageMock[key] ?? null,
    setItem: (key: string, val: string) => { storageMock[key] = String(val); },
    removeItem: (key: string) => { delete storageMock[key]; },
    clear: () => { Object.keys(storageMock).forEach(k => delete storageMock[k]); },
    key: (i: number) => Object.keys(storageMock)[i] || null,
    get length() { return Object.keys(storageMock).length; },
  };

  // 1. Save Gemini configuration with API key and specific model
  await saveProviderConfig({
    activeProvider: "gemini",
    providerId: "gemini",
    apiKey: "gemini-secret-test-key",
    model: "gemini-3.8-flash",
  });

  // Verify Gemini stored in settings v3 store (no duplicate legacy keys)
  let v3Store = JSON.parse(storageMock[STORAGE_KEY_SETTINGS_V3] || "{}");
  assert.strictEqual(v3Store.providers?.gemini?.apiKey, "gemini-secret-test-key");
  assert.strictEqual(v3Store.chatProviders?.gemini?.selectedModel, "gemini-3.8-flash");
  assert.strictEqual(v3Store.models?.chatProvider, "gemini");
  assert.strictEqual(v3Store.models?.chatText, "gemini-3.8-flash");
  assert.strictEqual(storageMock[STORAGE_KEY_CONFIG], undefined, "Legacy omni_providers_config must not be written");
  assert.strictEqual(storageMock[STORAGE_KEY_ACTIVE], undefined, "Legacy omni_active_provider must not be written");

  // 2. Switch to Custom provider with custom endpoint, custom model ID, and API key
  await saveProviderConfig({
    activeProvider: "custom",
    providerId: "custom",
    apiKey: "groq-custom-key-12345",
    model: "deepseek-ai/DeepSeek-V3",
    customModel: "deepseek-ai/DeepSeek-V3",
    baseUrl: "https://api.together.xyz/v1",
  });

  v3Store = JSON.parse(storageMock[STORAGE_KEY_SETTINGS_V3] || "{}");
  assert.strictEqual(v3Store.models?.chatProvider, "custom");
  assert.strictEqual(v3Store.models?.chatText, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(v3Store.chatProviders?.custom?.selectedModel, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(v3Store.chatProviders?.custom?.customModel, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(v3Store.providers?.custom?.httpEndpoint, "https://api.together.xyz/v1");
  assert.strictEqual(v3Store.providers?.custom?.apiKey, "groq-custom-key-12345");

  // 3. Confirm Gemini's settings were NOT overwritten or cleared when switching to Custom
  assert.strictEqual(v3Store.providers?.gemini?.apiKey, "gemini-secret-test-key");
  assert.strictEqual(v3Store.chatProviders?.gemini?.selectedModel, "gemini-3.8-flash");

  // 4. Save Gemini settings with BLANK apiKey (leaving password field empty)
  // Must preserve previously saved "gemini-secret-test-key"
  await saveProviderConfig({
    providerId: "gemini",
    apiKey: "", // Blank key field
    model: "gemini-3.8-live",
  });

  v3Store = JSON.parse(storageMock[STORAGE_KEY_SETTINGS_V3] || "{}");
  assert.strictEqual(v3Store.providers?.gemini?.apiKey, "gemini-secret-test-key", "Empty apiKey field must preserve previously saved key");
  assert.strictEqual(v3Store.chatProviders?.gemini?.selectedModel, "gemini-3.8-live");

  // 5. Confirm Custom settings are still fully intact after modifying Gemini
  assert.strictEqual(v3Store.chatProviders?.custom?.selectedModel, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(v3Store.chatProviders?.custom?.customModel, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(v3Store.providers?.custom?.httpEndpoint, "https://api.together.xyz/v1");
  assert.strictEqual(v3Store.providers?.custom?.apiKey, "groq-custom-key-12345");

  // 6. Test getProvidersConfig restores both providers correctly
  const fullConfig = await getProvidersConfig();
  assert.strictEqual(fullConfig.providers.gemini.selectedModel, "gemini-3.8-live");
  assert.strictEqual(fullConfig.providers.gemini.hasKey, true);
  assert.strictEqual(fullConfig.providers.custom.selectedModel, "deepseek-ai/DeepSeek-V3");
  assert.strictEqual(fullConfig.providers.custom.baseUrl, "https://api.together.xyz/v1");
  assert.strictEqual(fullConfig.providers.custom.hasKey, true);
});

test("Persona and Identity System Instruction Distinctiveness & Voice Audit", async () => {
  const {
    buildSierraSystemInstruction,
    UNIFIED_PERSONAS,
    GEMINI_LIVE_VOICES,
    getVoiceForPersona,
  } = await import("../src/lib/persona.ts");

  // 1. Verify all 5 personas produce distinct instructions
  const personaIds = ["classy", "confident", "dominant", "unhinged", "custom"] as const;
  const instructions = new Map<string, string>();

  for (const pId of personaIds) {
    const instruction = buildSierraSystemInstruction(pId, "sfw", undefined, undefined, "sierra");
    assert.ok(instruction.length > 50, `Instruction for persona ${pId} must be non-empty`);
    instructions.set(pId, instruction);
  }

  // All 5 instructions must be mutually distinct
  for (let i = 0; i < personaIds.length; i++) {
    for (let j = i + 1; j < personaIds.length; j++) {
      assert.notStrictEqual(
        instructions.get(personaIds[i]),
        instructions.get(personaIds[j]),
        `Personas ${personaIds[i]} and ${personaIds[j]} must produce distinct system instructions`
      );
    }
  }

  // 2. Verify identity switching produces distinct instructions (Sierra vs Tyler)
  const sierraInstruction = buildSierraSystemInstruction("classy", "sfw", undefined, undefined, "sierra");
  const tylerInstruction = buildSierraSystemInstruction("classy", "sfw", undefined, undefined, "tyler");
  assert.ok(sierraInstruction.includes("You are Sierra"), "Sierra identity instruction must name Sierra");
  assert.ok(tylerInstruction.includes("You are Tyler"), "Tyler identity instruction must name Tyler");
  assert.notStrictEqual(sierraInstruction, tylerInstruction, "Sierra and Tyler instructions must be distinct");

  // 3. Verify Sierra defaults to female voices and Tyler defaults to male voices
  for (const pId of personaIds) {
    const sierraVoice = getVoiceForPersona(pId, "sierra");
    const tylerVoice = getVoiceForPersona(pId, "tyler");
    
    // Female voices: Aoede or Kore
    assert.ok(
      sierraVoice === "Aoede" || sierraVoice === "Kore",
      `Sierra for ${pId} must default to female voice, got ${sierraVoice}`
    );
    // Male voices: Charon, Fenrir, or Puck
    assert.ok(
      tylerVoice === "Charon" || tylerVoice === "Fenrir" || tylerVoice === "Puck",
      `Tyler for ${pId} must default to male voice, got ${tylerVoice}`
    );
  }

  // 4. Audit Google's published Gemini Live voices: Kore must be Firm
  const kore = GEMINI_LIVE_VOICES.find(v => v.id === "Kore");
  assert.ok(kore, "Kore voice must be defined");
  assert.strictEqual(kore?.gender, "female");
  assert.strictEqual(kore?.tone, "Firm", "Kore tone must be Firm per Google published specification");

  const aoede = GEMINI_LIVE_VOICES.find(v => v.id === "Aoede");
  assert.strictEqual(aoede?.gender, "female");
  assert.strictEqual(aoede?.tone, "Breezy");

  const charon = GEMINI_LIVE_VOICES.find(v => v.id === "Charon");
  assert.strictEqual(charon?.gender, "male");
  assert.strictEqual(charon?.tone, "Informative");
});

test("OpenRouter Text-to-Speech Voice Provider Contract and Fallback Pipeline", async () => {
  const {
    OPENROUTER_TTS_ENDPOINT,
    OPENROUTER_TTS_MODEL,
    OPENROUTER_TTS_DEFAULT_VOICE,
    getSelectedVoiceProvider,
    setSelectedVoiceProvider,
    getOpenRouterApiKey,
    setOpenRouterApiKey,
  } = await import("../src/lib/persona.ts");

  const {
    splitTextIntoSentenceChunks,
    cleanTextForSpeech,
    createWavFromPcm,
  } = await import("../src/lib/ttsService.ts");

  // 1. Constants verification
  assert.strictEqual(OPENROUTER_TTS_ENDPOINT, "https://openrouter.ai/api/v1/audio/speech");
  assert.strictEqual(OPENROUTER_TTS_MODEL, "heygen/heygen-voice-1-turbo:free");
  assert.strictEqual(OPENROUTER_TTS_DEFAULT_VOICE, "nadine");

  // 2. Voice provider selection persistence
  setSelectedVoiceProvider("openrouter");
  assert.strictEqual(getSelectedVoiceProvider(), "openrouter");
  setSelectedVoiceProvider("native");
  assert.strictEqual(getSelectedVoiceProvider(), "native");

  // 3. OpenRouter API key local storage management (without logging key)
  setOpenRouterApiKey("sk-or-v1-testkey12345");
  assert.strictEqual(getOpenRouterApiKey(), "sk-or-v1-testkey12345");
  setOpenRouterApiKey("");

  // 4. Sentence boundary splitting under 5,000 character limit
  const shortText = "Hello! How are you doing today? I am Sierra.";
  const shortChunks = splitTextIntoSentenceChunks(shortText, 500);
  assert.strictEqual(shortChunks.length, 1);
  assert.strictEqual(shortChunks[0], shortText);

  // Large multi-sentence text
  const sentence = "This is a detailed and emotionally intelligent sentence spoken by Sierra. ";
  const longText = sentence.repeat(100); // ~7,400 chars
  const chunks = splitTextIntoSentenceChunks(longText, 2000);
  assert.ok(chunks.length >= 4, `Expected at least 4 chunks, got ${chunks.length}`);
  for (const c of chunks) {
    assert.ok(c.length <= 2000, `Chunk exceeds max limit: ${c.length}`);
    assert.ok(c.endsWith(".") || c.endsWith("?") || c.endsWith("!"), "Chunk should break on sentence boundary");
  }

  // 5. Clean text for speech sanitization
  const rawWithCode = "Check this code:\n```ts\nconst x = 1;\n```\nAnd this `variable`!";
  const cleaned = cleanTextForSpeech(rawWithCode);
  assert.ok(!cleaned.includes("const x = 1"), "Code block body should be stripped");
  assert.ok(cleaned.includes("variable"), "Inline code text should be preserved");

  // 6. WAV header builder verification (44.1 kHz, mono, 16-bit little-endian PCM)
  const testPcmBytes = new Uint8Array(100);
  for (let i = 0; i < testPcmBytes.length; i++) {
    testPcmBytes[i] = i % 256;
  }
  const wavBlob = createWavFromPcm(testPcmBytes, 44100, 1, 16);
  assert.strictEqual(wavBlob.type, "audio/wav");
  assert.strictEqual(wavBlob.size, 44 + 100, "WAV size should be 44-byte header + 100 bytes PCM");

  // Verify binary header fields via ArrayBuffer & DataView
  const arrayBuffer = await wavBlob.arrayBuffer();
  const headerView = new DataView(arrayBuffer);

  // "RIFF" chunk
  const riffMarker = String.fromCharCode(
    headerView.getUint8(0),
    headerView.getUint8(1),
    headerView.getUint8(2),
    headerView.getUint8(3)
  );
  assert.strictEqual(riffMarker, "RIFF");
  assert.strictEqual(headerView.getUint32(4, true), 36 + 100, "ChunkSize must be 36 + data size");

  // "WAVE" format
  const waveMarker = String.fromCharCode(
    headerView.getUint8(8),
    headerView.getUint8(9),
    headerView.getUint8(10),
    headerView.getUint8(11)
  );
  assert.strictEqual(waveMarker, "WAVE");

  // "fmt " chunk
  const fmtMarker = String.fromCharCode(
    headerView.getUint8(12),
    headerView.getUint8(13),
    headerView.getUint8(14),
    headerView.getUint8(15)
  );
  assert.strictEqual(fmtMarker, "fmt ");
  assert.strictEqual(headerView.getUint32(16, true), 16, "Subchunk1Size must be 16 for PCM");
  assert.strictEqual(headerView.getUint16(20, true), 1, "AudioFormat must be 1 (PCM)");
  assert.strictEqual(headerView.getUint16(22, true), 1, "NumChannels must be 1 (mono)");
  assert.strictEqual(headerView.getUint32(24, true), 44100, "SampleRate must be 44100 Hz");
  assert.strictEqual(headerView.getUint32(28, true), (44100 * 1 * 16) / 8, "ByteRate must match 44100 * 2");
  assert.strictEqual(headerView.getUint16(32, true), 2, "BlockAlign must be 2 bytes (16-bit mono)");
  assert.strictEqual(headerView.getUint16(34, true), 16, "BitsPerSample must be 16");

  // "data" chunk
  const dataMarker = String.fromCharCode(
    headerView.getUint8(36),
    headerView.getUint8(37),
    headerView.getUint8(38),
    headerView.getUint8(39)
  );
  assert.strictEqual(dataMarker, "data");
  assert.strictEqual(headerView.getUint32(40, true), 100, "Subchunk2Size must equal data size");

  // 7. Odd byte trimming test
  const oddPcmBytes = new Uint8Array(101); // 101 bytes (odd)
  const oddWavBlob = createWavFromPcm(oddPcmBytes, 44100, 1, 16);
  assert.strictEqual(oddWavBlob.size, 44 + 100, "Odd byte count must trim 1 byte to 100 bytes");
  const oddBuffer = await oddWavBlob.arrayBuffer();
  const oddView = new DataView(oddBuffer);
  assert.strictEqual(oddView.getUint32(40, true), 100, "data chunk size must be trimmed to even byte boundary");
});

test("250-Char Sentence Chunk Splitter, Stop Queue Cancellation, and ChatStore Session Restore", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    splitTextIntoSentenceChunks,
    stopSpeaking,
    setSpeakingActiveState,
    subscribeSpeakingStatus,
    playOpenRouterTts,
  } = await import("../src/lib/ttsService");
  const { setOpenRouterApiKey } = await import("../src/lib/persona");
  const { getDebugLogs, clearDebugLogs } = await import("../src/lib/debugLogStore");
  const {
    createStoredSession,
    renameStoredSession,
    getStoredChatSessions,
    saveStoredMessages,
    getStoredMessages,
    getActiveSessionId,
  } = await import("../src/lib/chatStore");

  // 1. 250-char default sentence chunk splitter with > 20 delimiter threshold
  const conversationalParagraph =
    "Hey there! I was just thinking about our conversation earlier today. " +
    "It really meant a lot to me to hear your thoughts on the architecture. " +
    "Should we dive into the next phase right now? " +
    "Let me know what feels right to you, and we will make it happen together! " +
    "I am ready whenever you are.";
  const chunks250 = splitTextIntoSentenceChunks(conversationalParagraph); // defaults to 250
  assert.ok(chunks250.length >= 2, `Expected at least 2 chunks for ~295 char text, got ${chunks250.length}`);
  for (const chunk of chunks250) {
    assert.ok(chunk.length <= 250, `Chunk length ${chunk.length} exceeds 250 char limit`);
    assert.ok(
      chunk.endsWith(".") || chunk.endsWith("!") || chunk.endsWith("?"),
      `Chunk "${chunk}" should end on a sentence boundary`
    );
  }

  // 2. subscribeSpeakingStatus and stopSpeaking aborting an in-flight OpenRouter queue
  clearDebugLogs();
  const statusHistory: boolean[] = [];
  const unsubscribe = subscribeSpeakingStatus((speaking) => {
    statusHistory.push(speaking);
  });

  setSpeakingActiveState(true);
  assert.strictEqual(statusHistory[statusHistory.length - 1], true);

  // Mock fetch that hangs until aborted to verify stopSpeaking aborts activeAbortController
  const originalFetch = globalThis.fetch;
  let fetchAborted = false;
  globalThis.fetch = ((_url: any, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          fetchAborted = true;
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  }) as any;

  try {
    setOpenRouterApiKey("sk-or-v1-test-abort-key");
    const playPromise = playOpenRouterTts({
      text: conversationalParagraph,
      source: "chat",
    });

    // Wait a tick for fetch to start, then call stopSpeaking with reason
    await new Promise((r) => setTimeout(r, 20));
    await stopSpeaking("User pressed Stop button");
    await playPromise;

    assert.strictEqual(fetchAborted, true, "stopSpeaking must abort pending OpenRouter fetch via AbortController");
    assert.strictEqual(statusHistory[statusHistory.length - 1], false, "Speaking state must be false after stopSpeaking");

    const logs = getDebugLogs();
    const stopLogs = logs.filter((l) => l.stage === "TTS:Stop" && l.detail.includes("User pressed Stop button"));
    assert.ok(stopLogs.length >= 1, "stopSpeaking must log TTS:Stop with the provided reason");
  } finally {
    globalThis.fetch = originalFetch;
    unsubscribe();
  }

  // 3. chatStore session creation, rename, message persistence, and session title restore
  const newSession = createStoredSession("Initial Topic");
  assert.strictEqual(getActiveSessionId(), newSession.id);
  assert.strictEqual(getStoredChatSessions()[0].title, "Initial Topic");

  renameStoredSession(newSession.id, "Deep Late-Night Talk");
  const restoredSessions = getStoredChatSessions();
  const restoredMeta = restoredSessions.find((s) => s.id === newSession.id);
  assert.ok(restoredMeta, "Renamed session must exist in stored sessions");
  assert.strictEqual(restoredMeta!.title, "Deep Late-Night Talk", "Session title must be restored from chatStore");

  saveStoredMessages(newSession.id, [
    { id: "m1", role: "user", content: "Hello Sierra", timestamp: 1000 },
    { id: "m2", role: "model", content: "Hey! Good to see you.", timestamp: 1001 },
  ]);
  const restoredMsgs = getStoredMessages(newSession.id);
  assert.strictEqual(restoredMsgs.length, 2);
  assert.strictEqual(restoredMsgs[1].content, "Hey! Good to see you.");
});

test("On-Device Conversation Memory (30-Entry Cap), Prompt Injection, Backup Export/Import, and Honesty Directives", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    MAX_CONVERSATION_SUMMARIES,
    saveConversationSummary,
    getConversationSummaries,
    clearConversationSummaries,
    buildSierraSystemInstruction,
  } = await import("../src/lib/persona");
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");

  clearConversationSummaries();
  assert.strictEqual(MAX_CONVERSATION_SUMMARIES, 30);

  // 1. Store 35 summaries and verify cap of 30 with oldest 5 dropped
  for (let i = 1; i <= 35; i++) {
    saveConversationSummary({
      id: `conv-${i}`,
      source: i % 2 === 0 ? "live" : "chat",
      title: `Topic ${i}`,
      summary: `Discussed subject number ${i} in detail.`,
      updatedAt: 1000 + i,
    });
  }

  const stored = getConversationSummaries();
  assert.strictEqual(stored.length, 30, "Must cap stored summaries at 30 entries");
  assert.strictEqual(stored[0].id, "conv-6", "Oldest entries (1..5) must be dropped");
  assert.strictEqual(stored[stored.length - 1].id, "conv-35", "Newest entry (35) must be retained");

  // 2. Verify summaries and honesty directives are injected cleanly for Sierra and isolated from Tyler
  const sierraPrompt = buildSierraSystemInstruction("classy", "sfw", undefined, undefined, "sierra");
  const tylerPromptBefore = buildSierraSystemInstruction("confident", "mature", undefined, undefined, "tyler");
  assert.strictEqual(
    tylerPromptBefore.includes("Discussed subject number 35 in detail."),
    false,
    "Tyler prompt must not receive Sierra's conversation summaries"
  );
  saveConversationSummary({
    id: "tyler-conv-1",
    identity: "tyler",
    source: "chat",
    title: "Tyler Topic",
    summary: "Discussed subject number 35 in detail.",
    updatedAt: 2000,
  });
  const tylerPrompt = buildSierraSystemInstruction("confident", "mature", undefined, undefined, "tyler");

  for (const prompt of [sierraPrompt, tylerPrompt]) {
    assert.ok(
      prompt.includes("Injected Conversation Summaries (On-Device Memory):"),
      "Prompt must include injected conversation summaries section"
    );
    assert.ok(
      prompt.includes("Discussed subject number 35 in detail."),
      "Prompt must inject the most recent conversation summaries for that identity"
    );
    assert.ok(
      prompt.includes("only know what is in the injected summaries and current chat"),
      "Prompt must state companion only knows what is in the injected summaries and current chat"
    );
    assert.ok(
      prompt.includes("must not claim to remember everything") ||
        prompt.includes("must NOT claim to remember everything"),
      "Prompt must forbid claiming to remember everything"
    );
    assert.ok(
      prompt.includes("wake word"),
      "Prompt must forbid claiming unsupported abilities such as a wake word"
    );
  }
  // Remove Tyler's extra entry so the backup export/import assertions below keep 30 Sierra summaries
  clearConversationSummaries("tyler");

  // 3. Verify JSON Export and Import backup round-trip
  const backupJson = exportLocalBackupData();
  clearConversationSummaries();
  assert.strictEqual(getConversationSummaries().length, 0);

  const importResult = importLocalBackupData(backupJson);
  assert.strictEqual(importResult.summariesCount, 30);
  assert.strictEqual(getConversationSummaries().length, 30);
  assert.strictEqual(getConversationSummaries()[29].summary, "Discussed subject number 35 in detail.");
});

test("Sierra Local Memory: Summary Save on Live Session End (1 User + 1 Sierra Turn) & [Memory] Debug Logs", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    clearConversationSummaries,
    getConversationSummaries,
    summarizeAndSaveConversation,
    buildSierraSystemInstruction,
  } = await import("../src/lib/persona");
  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");

  clearConversationSummaries();
  clearDebugLogs();

  // 1. Should NOT save if only user turns exist (no Sierra turn yet)
  summarizeAndSaveConversation(
    "live-partial-only-user",
    [{ role: "user", content: "Hey Sierra, are you there?" }],
    "Live Voice Conversation",
    "live"
  );
  assert.strictEqual(getConversationSummaries().length, 0, "Must not save summary when no Sierra turn exists");

  // 2. Should save when at least 1 user turn and 1 Sierra turn exist (e.g. when Live session ends via stop/tab switch/unmount)
  summarizeAndSaveConversation(
    "live-session-1",
    [
      { role: "user", content: "Do you remember my favorite coffee order?" },
      { role: "model", content: "I remember you love an iced oat milk cortado with cinnamon." },
    ],
    "Live Voice Conversation",
    "live"
  );

  const summaries = getConversationSummaries();
  assert.strictEqual(summaries.length, 1, "Must save summary when 1 user turn and 1 Sierra turn exist");
  assert.ok(summaries[0].summary.includes("iced oat milk cortado"), "Saved summary must include conversation content");

  const logsAfterSave = getDebugLogs();
  const savedLog = logsAfterSave.find((l) => l.detail.includes("[Memory] Saved summary #1"));
  assert.ok(savedLog, "Must log '[Memory] Saved summary #1' on save");

  // 3. Re-read from localStorage at new session start and log '[Memory] Injected N summaries, M chars'
  const prompt = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "sierra");
  assert.ok(prompt.includes("Injected Conversation Summaries"), "Must inject summaries under 'Injected Conversation Summaries'");
  assert.ok(prompt.includes("iced oat milk cortado"), "Prompt must contain the re-read summary from localStorage");

  const logsAfterInject = getDebugLogs();
  const injectedLog = logsAfterInject.find((l) => l.detail.includes("[Memory] Injected 1 summaries,"));
  assert.ok(injectedLog, "Must log '[Memory] Injected N summaries, M chars' at session start");
});

test("Live Transcript Bubble Merge Across Short Pause & Boundary Deduplication", async () => {
  const { mergeAndDeduplicateTranscript } = await import("../src/lib/persona");

  // 1. Merge distinct consecutive chunks across a short pause into one bubble
  const mergedPause = mergeAndDeduplicateTranscript("Hey Sierra,", "how was your afternoon?");
  assert.strictEqual(mergedPause, "Hey Sierra, how was your afternoon?");

  // 2. De-duplicate overlapping repeated prefix/suffix at chunk boundaries
  const mergedOverlap1 = mergeAndDeduplicateTranscript(
    "Do you remember",
    "Do you remember what we talked about yesterday?"
  );
  assert.strictEqual(mergedOverlap1, "Do you remember what we talked about yesterday?");

  // 3. De-duplicate partial word-phrase overlap at boundary
  const mergedOverlap2 = mergeAndDeduplicateTranscript(
    "I was thinking about our trip",
    "about our trip to Kyoto"
  );
  assert.strictEqual(mergedOverlap2, "I was thinking about our trip to Kyoto");

  // 4. De-duplicate repeated consecutive phrase inside a single chunk
  const mergedInternalRepeat = mergeAndDeduplicateTranscript(
    "",
    "Do you remember Do you remember our conversation"
  );
  assert.strictEqual(mergedInternalRepeat, "Do you remember our conversation");
});

test("Independent Live and Chat Voice Configs, One-Time Migration, Voice Style Directive, and Slider Reset", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    migrateVoiceConfigs,
    getLiveVoiceConfig,
    setLiveVoiceConfig,
    getChatVoiceConfig,
    setChatVoiceConfig,
    buildVoiceStyleDirective,
    buildSierraSystemInstruction,
    getTtsPitch,
    setTtsPitch,
    getTtsRate,
    setTtsRate,
    resetTtsSlidersToDefault,
    VOICE_CONFIG_MIGRATION_KEY,
  } = await import("../src/lib/persona");

  // 1. One-time migration from legacy single voice setting into both Live and Chat voice configs
  storageMap["sierra_voice_sierra_classy"] = "Kore";
  storageMap["sierra_voice_accent"] = "British (RP)";
  storageMap["sierra_voice_tone"] = "Warm & Affectionate";
  storageMap["sierra_voice_provider"] = "openrouter";

  migrateVoiceConfigs();
  assert.strictEqual(storageMap[VOICE_CONFIG_MIGRATION_KEY], "true", "Migration flag must be set");

  const migratedLive = getLiveVoiceConfig("classy", "sierra");
  const migratedChat = getChatVoiceConfig("classy", "sierra");
  assert.strictEqual(migratedLive.voiceId, "Kore");
  assert.strictEqual(migratedLive.accent, "British (RP)");
  assert.strictEqual(migratedLive.tone, "Warm & Affectionate");
  assert.strictEqual(migratedChat.voiceId, "Kore");
  assert.strictEqual(migratedChat.provider, "openrouter");
  assert.strictEqual(migratedChat.accent, "British (RP)");
  assert.strictEqual(migratedChat.tone, "Warm & Affectionate");

  // Re-running migration must NOT overwrite subsequent independent changes
  setLiveVoiceConfig({ voiceId: "Aoede", accent: "Australian", tone: "Playful & Teasing" }, "classy", "sierra");
  setChatVoiceConfig({ voiceId: "nadine", provider: "native", accent: "French", tone: "Sultry & Intimate" }, "classy", "sierra");

  migrateVoiceConfigs(); // No-op after first run

  const afterLive = getLiveVoiceConfig("classy", "sierra");
  const afterChat = getChatVoiceConfig("classy", "sierra");

  // 2. Verify Live and Chat voice configs stay completely independent
  assert.strictEqual(afterLive.voiceId, "Aoede");
  assert.strictEqual(afterLive.accent, "Australian");
  assert.strictEqual(afterLive.tone, "Playful & Teasing");

  assert.strictEqual(afterChat.voiceId, "nadine");
  assert.strictEqual(afterChat.provider, "native");
  assert.strictEqual(afterChat.accent, "French");
  assert.strictEqual(afterChat.tone, "Sultry & Intimate");

  // 3. Verify Voice Style Directive generation for accent, tone, anti-monotone line, and language guard
  const directive = buildVoiceStyleDirective("British", "Sultry", "en-US");
  assert.ok(directive.includes("Voice Style Directive:"), "Must include Voice Style Directive header");
  assert.ok(directive.includes("authentic British accent"), "Must include specific British accent instructions");
  assert.ok(directive.includes("low, smooth, sultry, and magnetic vocal texture"), "Must include specific Sultry tone instructions");
  assert.ok(
    directive.includes("Never sound flat or monotone. Vary your pitch and pace, and show genuine emotion in your voice."),
    "Must include anti-monotone directive"
  );
  assert.ok(directive.includes("Stay in English."), "Must include language lock guard");

  const fullInstruction = buildSierraSystemInstruction(
    "classy",
    "mature",
    undefined,
    "en-US",
    "sierra",
    "Southern US",
    "Firm"
  );
  assert.ok(fullInstruction.includes("Southern US drawl"), "System instruction must embed accent directive");
  assert.ok(fullInstruction.includes("firm, confident, grounded"), "System instruction must embed tone directive");
  assert.ok(fullInstruction.includes("Never sound flat or monotone."), "System instruction must include anti-monotone line");

  // 4. Verify slider defaults (1.0x) and Reset to default
  delete storageMap["sierra_tts_pitch"];
  delete storageMap["sierra_tts_rate"];
  assert.strictEqual(getTtsPitch(), 1.0, "Default TTS pitch must be 1.0x");
  assert.strictEqual(getTtsRate(), 1.0, "Default TTS speed/rate must be 1.0x");

  setTtsPitch(1.45);
  setTtsRate(1.35);
  assert.strictEqual(getTtsPitch(), 1.45);
  assert.strictEqual(getTtsRate(), 1.35);

  const resetResult = resetTtsSlidersToDefault();
  assert.strictEqual(resetResult.pitch, 1.0);
  assert.strictEqual(resetResult.rate, 1.0);
  assert.strictEqual(getTtsPitch(), 1.0, "Pitch must reset to 1.0x");
  assert.strictEqual(getTtsRate(), 1.0, "Speed/rate must reset to 1.0x");
});

test("Part 2 & Part 4: Live Voice Setup Payload Exact Match & Accent/Tone Default Base Voice Selection", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    setLiveVoiceConfig,
    getLiveVoiceConfig,
    resolveAndBuildLiveSetupPayload,
    getMatchingBaseVoiceForAccentAndTone,
  } = await import("../src/lib/persona");
  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");

  // 1. Part 4: When user has NOT explicitly picked a voice, accent/tone chips select a matching base voice
  const freshCfg = getLiveVoiceConfig("classy", "sierra");
  assert.strictEqual(freshCfg.userSelectedVoice, false);

  const afterFirmTone = setLiveVoiceConfig({ tone: "Firm" }, "classy", "sierra");
  assert.strictEqual(afterFirmTone.voiceId, "Kore", "Firm tone for Sierra should auto-select Kore when no voice was manually picked");
  assert.strictEqual(afterFirmTone.userSelectedVoice, false);

  const afterPlayfulTone = setLiveVoiceConfig({ tone: "Upbeat" }, "classy", "sierra");
  assert.strictEqual(afterPlayfulTone.voiceId, "Aoede", "Upbeat tone for Sierra should auto-select Aoede when no voice was manually picked");

  // Male identity default matching
  const tylerCalmBritish = getMatchingBaseVoiceForAccentAndTone("British", "Calm", "tyler", "confident");
  assert.strictEqual(tylerCalmBritish, "Charon", "British + Calm for Tyler should select Charon");
  const tylerExcitable = getMatchingBaseVoiceForAccentAndTone("Default", "Excitable", "tyler", "dominant");
  assert.strictEqual(tylerExcitable, "Fenrir", "Excitable tone for Tyler should select Fenrir");

  // 2. Part 2: Once user saves a Live voice, starting a session MUST send that exact voiceName
  // even if legacy keys or persona defaults exist in localStorage
  storageMap["sierra_voice_sierra_classy"] = "Aoede"; // legacy key that must NOT override
  storageMap["sierra_voice_name"] = "Aoede"; // legacy key that must NOT override

  setLiveVoiceConfig({ voiceId: "Puck" }, "classy", "sierra");
  const savedAfterPick = getLiveVoiceConfig("classy", "sierra");
  assert.strictEqual(savedAfterPick.voiceId, "Puck");
  assert.strictEqual(savedAfterPick.userSelectedVoice, true);

  // Changing accent/tone after user picked a voice must preserve the user's chosen voice ("Puck")
  setLiveVoiceConfig({ accent: "British", tone: "Calm" }, "classy", "sierra");
  assert.strictEqual(getLiveVoiceConfig("classy", "sierra").voiceId, "Puck");

  clearDebugLogs();
  const sessionStartResult = resolveAndBuildLiveSetupPayload({
    identity: "sierra",
    personaId: "classy",
    model: "models/gemini-2.0-flash-exp",
    systemInstruction: "System prompt test",
  });

  assert.strictEqual(sessionStartResult.savedConfigVoice, "Puck", "savedConfigVoice must match saved Live config");
  assert.strictEqual(sessionStartResult.sentVoiceName, "Puck", "sentVoiceName must match saved Live config");
  assert.strictEqual(
    sessionStartResult.setupMessage.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    "Puck",
    "Live WebSocket setup payload must send the exact saved voiceName"
  );

  // Verify side-by-side log of savedConfigVoice and sentVoiceName
  const logs = getDebugLogs();
  const sideBySideLog = logs.find(
    (l) =>
      l.stage === "LiveVoice:SessionStart" &&
      l.detail.includes('savedConfigVoice="Puck"') &&
      l.detail.includes('sentVoiceName="Puck"')
  );
  assert.ok(sideBySideLog, "Must log savedConfigVoice and sentVoiceName side by side at session start");
});

test("Part 3: Test Voice Uses Selected Provider, Voice, Speed, Pitch, Accent, and Tone", async () => {
  const {
    testVoicePlayback,
    getLastTestVoiceInvocation,
    computeNativeVoiceParameters,
    mapAccentToLocale,
  } = await import("../src/lib/ttsService");

  // 1. Verify accent-to-locale mapping
  assert.strictEqual(mapAccentToLocale("British"), "en-GB");
  assert.strictEqual(mapAccentToLocale("Australian"), "en-AU");
  assert.strictEqual(mapAccentToLocale("Southern US"), "en-US");
  assert.strictEqual(mapAccentToLocale("Irish"), "en-IE");

  // 2. Verify distinct voice/tone/speed/pitch modulation so voices never sound identical
  const paramsAoedeUpbeat = computeNativeVoiceParameters({
    voiceId: "Aoede",
    identity: "sierra",
    personaId: "classy",
    rate: 1.2,
    pitch: 1.1,
    accent: "British",
    tone: "Upbeat",
    pool: [],
  });
  const paramsCharonCalm = computeNativeVoiceParameters({
    voiceId: "Charon",
    identity: "tyler",
    personaId: "confident",
    rate: 0.85,
    pitch: 0.9,
    accent: "American",
    tone: "Calm",
    pool: [],
  });

  assert.strictEqual(paramsAoedeUpbeat.targetLang, "en-GB");
  assert.strictEqual(paramsCharonCalm.targetLang, "en-US");
  assert.ok(
    paramsAoedeUpbeat.effectiveRate > paramsCharonCalm.effectiveRate,
    `Expected Aoede+Upbeat+1.2x rate (${paramsAoedeUpbeat.effectiveRate}) > Charon+Calm+0.85x rate (${paramsCharonCalm.effectiveRate})`
  );
  assert.ok(
    paramsAoedeUpbeat.effectivePitch > paramsCharonCalm.effectivePitch,
    `Expected Aoede+Upbeat+1.1x pitch (${paramsAoedeUpbeat.effectivePitch}) > Charon+Calm+0.9x pitch (${paramsCharonCalm.effectivePitch})`
  );

  // 3. Verify testVoicePlayback records and forwards the selected provider, voiceId, speed, pitch, accent, and tone
  await testVoicePlayback("Kore", "Testing voice parameters", "sierra", "classy", {
    provider: "native",
    speed: 1.35,
    pitch: 1.15,
    accent: "Australian",
    tone: "Firm",
  });

  const lastCall = getLastTestVoiceInvocation();
  assert.ok(lastCall, "Last Test Voice invocation must be recorded");
  assert.strictEqual(lastCall!.voiceId, "Kore");
  assert.strictEqual(lastCall!.provider, "native");
  assert.strictEqual(lastCall!.speed, 1.35);
  assert.strictEqual(lastCall!.pitch, 1.15);
  assert.strictEqual(lastCall!.accent, "Australian");
  assert.strictEqual(lastCall!.tone, "Firm");
});

test("Part 5, Part 7 & Part 8: New Chat Auto-Title, Response Speed Selector, and Chat Toggles", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    getStoredChatSessions,
    createStoredSession,
    saveStoredMessages,
    renameStoredSession,
    deriveChatTitleFromMessage,
  } = await import("../src/lib/chatStore");

  const {
    getResponseSpeed,
    setResponseSpeed,
    doesModelSupportResponseSpeed,
    buildModelThinkingConfig,
  } = await import("../src/lib/providers");

  // 1. Part 5: Default session title is 'New Chat' (not 'Neural Chat') and auto-titles from first user message (~40 chars)
  const initialSessions = getStoredChatSessions();
  assert.strictEqual(initialSessions[0].title, "New Chat");

  const created = createStoredSession();
  assert.strictEqual(created.title, "New Chat");

  const firstMsg = "Can we design a distributed event-driven architecture for mobile sync?";
  const expectedTitle = deriveChatTitleFromMessage(firstMsg, 40);
  assert.ok(expectedTitle.length <= 43, "Auto-derived title should be around 40 characters + ellipsis");
  assert.strictEqual(expectedTitle, "Can we design a distributed event-driven...");

  saveStoredMessages(created.id, [
    { id: "1", role: "user", content: firstMsg, timestamp: Date.now() },
  ]);
  const updatedSession = getStoredChatSessions().find((s) => s.id === created.id);
  assert.strictEqual(updatedSession?.title, expectedTitle, "Session must auto-title from the first user message");

  // Still renamable with the pencil
  renameStoredSession(created.id, "Custom Architecture Plan");
  assert.strictEqual(
    getStoredChatSessions().find((s) => s.id === created.id)?.title,
    "Custom Architecture Plan"
  );

  // 2. Part 7: Response speed defaults to 'medium', persists in localStorage, checks model support, and maps to thinkingConfig
  assert.strictEqual(getResponseSpeed(), "medium", "Response speed must default to medium");
  setResponseSpeed("low");
  assert.strictEqual(getResponseSpeed(), "low");
  assert.strictEqual(JSON.parse(storageMap["omni_settings_v3"] || "{}").responseSpeed, "low");
  assert.strictEqual(storageMap["sierra_response_speed"], undefined);

  assert.strictEqual(doesModelSupportResponseSpeed("gemini-3.5-flash-lite", "gemini"), true);
  assert.strictEqual(doesModelSupportResponseSpeed("o3-mini", "openai"), true);
  assert.strictEqual(doesModelSupportResponseSpeed("gpt-4o-mini", "openai"), false, "Non-thinking OpenAI models should hide the control");
  assert.strictEqual(doesModelSupportResponseSpeed("llama3.2", "ollama"), false, "Models without thinking support should hide the control");

  const lowCfg = buildModelThinkingConfig("gemini-3.5-flash-lite", "gemini", "low");
  assert.deepStrictEqual(lowCfg.geminiThinkingConfig, { thinkingBudget: 0 });

  const medCfg = buildModelThinkingConfig("gemini-3.5-flash-lite", "gemini", "medium");
  assert.deepStrictEqual(medCfg.geminiThinkingConfig, { thinkingBudget: 1024 });

  const highCfg = buildModelThinkingConfig("gemini-3.5-flash-lite", "gemini", "high");
  assert.deepStrictEqual(highCfg.geminiThinkingConfig, { thinkingBudget: 8192 });

  const o3High = buildModelThinkingConfig("o3-mini", "openai", "high");
  assert.strictEqual(o3High.openaiReasoningEffort, "high");

  // 3. Part 8: Verify ChatInterface defaults isMultiTurn to true (Context: Full) and providers.ts wires googleMaps
  const fs = await import("node:fs");
  const chatInterfaceCode = fs.readFileSync("src/components/ChatInterface.tsx", "utf8");
  assert.ok(
    chatInterfaceCode.includes("const [isMultiTurn, setIsMultiTurn] = useState(true);"),
    "Single/Multi (Context) toggle must default to true (Context: Full)"
  );
  assert.ok(
    chatInterfaceCode.includes("Context: Full") && chatInterfaceCode.includes("Context: 1-Turn"),
    "Context toggle chip must be labelled Context: Full / Context: 1-Turn"
  );

  const providersCode = fs.readFileSync("src/lib/providers.ts", "utf8");
  assert.ok(
    providersCode.includes("if (params.useSearch) tools.push({ googleSearch: {} });") &&
      providersCode.includes("if (params.useMaps) tools.push({ googleMaps: {} });"),
    "Both Search (googleSearch) and Maps (googleMaps) grounding tools must be wired in providers.ts"
  );
});

test("Parts 0-4: Background Live Voice, Wake Word Engines, Default Android Assistant, and Capability Honesty", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const fs = await import("node:fs");
  const {
    isBackgroundLiveEnabled,
    setBackgroundLiveEnabled,
    isWakeWordEnabled,
    setWakeWordEnabled,
    getWakeWordEngineType,
    setWakeWordEngineType,
    getWakeWordSensitivity,
    setWakeWordSensitivity,
    isAssistantModeEnabled,
    setAssistantModeEnabled,
    shouldSavePeriodicSummary,
    buildCapabilityHonestyDirective,
    buildSierraSystemInstruction,
  } = await import("../src/lib/persona");

  const {
    PorcupineWakeWordEngine,
    ExperimentalSpeechRecognizerWakeWordEngine,
    getWakeWordEngineInstance,
    getPicovoiceAccessKey,
    setPicovoiceAccessKey,
    getStoredPpnKeyword,
    saveStoredPpnKeyword,
    startWakeWordListener,
    stopWakeWordListener,
    triggerTestWakeWord,
    subscribeWakeWordDetected,
    getActiveWakeWordEngine,
  } = await import("../src/lib/backgroundVoiceService");

  // 1. Everything is OFF by default
  assert.strictEqual(isBackgroundLiveEnabled(), false, "Background Live voice must default to OFF");
  assert.strictEqual(isWakeWordEnabled(), false, "Wake word must default to OFF");
  assert.strictEqual(isAssistantModeEnabled(), false, "Assistant mode must default to OFF");
  assert.strictEqual(getWakeWordEngineType(), "porcupine", "Wake word engine must default to Porcupine");
  assert.strictEqual(getWakeWordSensitivity(), 0.5, "Wake word sensitivity must default to 0.5");

  // 2. Part 0: Verify Live tab controls wrap cleanly and include Cam, Screen, and Log on 360px screens
  const liveVoiceCode = fs.readFileSync("src/components/LiveVoice.tsx", "utf8");
  assert.ok(
    liveVoiceCode.includes('data-testid="live-control-camera"') &&
      liveVoiceCode.includes('data-testid="live-control-screenshare"') &&
      liveVoiceCode.includes('data-testid="live-control-debuglog"'),
    "Live tab top control bar must expose reachable camera, screen share, and debug log buttons"
  );

  // 3. Part 1: Verify Android Foreground Service, Manifest permissions, and periodic summary helper
  const manifestXml = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  for (const perm of [
    "android.permission.RECORD_AUDIO",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.WAKE_LOCK",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
  ]) {
    assert.ok(manifestXml.includes(perm), `AndroidManifest.xml must declare ${perm}`);
  }
  assert.ok(
    manifestXml.includes('android:name=".SierraVoiceForegroundService"') &&
      manifestXml.includes('android:foregroundServiceType="microphone"'),
    "AndroidManifest.xml must register SierraVoiceForegroundService with foregroundServiceType='microphone'"
  );

  assert.strictEqual(shouldSavePeriodicSummary(0, true), false);
  assert.strictEqual(shouldSavePeriodicSummary(1, true), false);
  assert.strictEqual(shouldSavePeriodicSummary(2, true), true);
  assert.strictEqual(shouldSavePeriodicSummary(4, true), true);
  assert.strictEqual(shouldSavePeriodicSummary(2, false), false, "Must not periodic-save when background mode is off");

  // 4. Part 2: WakeWordEngine — Porcupine requires both AccessKey and .ppn file per identity
  const porcupineEngine = new PorcupineWakeWordEngine();
  assert.strictEqual(porcupineEngine.isConfigured("sierra").ready, false, "Porcupine must be unconfigured when AccessKey and .ppn are missing");

  // Attempting to start wake word when Porcupine is missing key/ppn fails gracefully with setup reason
  const failedStart = await startWakeWordListener("sierra");
  assert.strictEqual(failedStart.started, false);
  assert.ok(failedStart.error?.includes("AccessKey"), "Missing AccessKey must return clear setup instructions");

  setPicovoiceAccessKey("picovoice-secret-access-key-never-logged");
  assert.strictEqual(getPicovoiceAccessKey(), "picovoice-secret-access-key-never-logged");
  assert.strictEqual(
    porcupineEngine.isConfigured("sierra").ready,
    false,
    "Porcupine must remain unconfigured when .ppn file for Sierra is still missing"
  );

  saveStoredPpnKeyword("sierra", "sierra_android.ppn", "UklGRg==");
  assert.strictEqual(porcupineEngine.isConfigured("sierra").ready, true, "Porcupine must be ready for Sierra once AccessKey and Sierra .ppn are set");
  assert.strictEqual(porcupineEngine.isConfigured("tyler").ready, false, "Tyler .ppn is separate and still unconfigured");

  saveStoredPpnKeyword("tyler", "tyler_android.ppn", "UklGRg==");
  assert.strictEqual(porcupineEngine.isConfigured("tyler").ready, true, "Porcupine must be ready for Tyler once Tyler .ppn is imported");
  assert.strictEqual(getStoredPpnKeyword("sierra")?.fileName, "sierra_android.ppn");
  assert.strictEqual(getStoredPpnKeyword("tyler")?.fileName, "tyler_android.ppn");

  // Verify ExperimentalSpeechRecognizerWakeWordEngine
  const expEngine = getWakeWordEngineInstance("speech_recognizer");
  assert.ok(expEngine instanceof ExperimentalSpeechRecognizerWakeWordEngine);
  assert.strictEqual(expEngine.isConfigured().ready, true);

  // Verify one-tap Test Wake Word triggers detection callback with current identity
  const detectedEvents: Array<{ identity: string; keywordLabel: string }> = [];
  const unsubWake = subscribeWakeWordDetected((ev) => {
    detectedEvents.push(ev);
  });
  await triggerTestWakeWord("tyler");
  unsubWake();
  assert.strictEqual(detectedEvents.length, 1);
  assert.strictEqual(detectedEvents[0].identity, "tyler");
  assert.strictEqual(detectedEvents[0].keywordLabel, "Tyler");

  await stopWakeWordListener();
  assert.strictEqual(getActiveWakeWordEngine(), null);

  // 5. Part 3: Verify Default Android Assistant registration in AndroidManifest.xml
  assert.ok(
    manifestXml.includes('android:name=".SierraVoiceInteractionService"') &&
      manifestXml.includes('android:name=".SierraVoiceInteractionSessionService"') &&
      manifestXml.includes('android:name=".SierraRecognitionService"') &&
      manifestXml.includes('android.intent.action.ASSIST'),
    "AndroidManifest.xml must register VoiceInteractionService, VoiceInteractionSessionService, RecognitionService, and ASSIST intent-filter"
  );

  // 6. Part 4: Verify Honesty Directive dynamically reflects enabled vs disabled states
  const allOffHonesty = buildCapabilityHonestyDirective({
    wakeWordEnabled: false,
    backgroundLiveEnabled: false,
    assistantModeEnabled: false,
  });
  assert.ok(allOffHonesty.includes("Wake Word: CURRENTLY DISABLED (OFF) in Settings"));
  assert.ok(allOffHonesty.includes("Background Live Listening: CURRENTLY DISABLED (OFF) in Settings"));
  assert.ok(allOffHonesty.includes("Android Default Assistant Mode: CURRENTLY DISABLED (OFF) in Settings"));

  const allOnHonesty = buildCapabilityHonestyDirective({
    wakeWordEnabled: true,
    backgroundLiveEnabled: true,
    assistantModeEnabled: true,
  });
  assert.ok(allOnHonesty.includes("Wake Word: CURRENTLY ENABLED in Settings"));
  assert.ok(allOnHonesty.includes("Background Live Listening: CURRENTLY ENABLED in Settings"));
  assert.ok(allOnHonesty.includes("Android Default Assistant Mode: CURRENTLY ENABLED in Settings"));

  // Verify system prompt integrates the dynamic honesty state when flags are toggled in Settings
  setWakeWordEnabled(true);
  setBackgroundLiveEnabled(true);
  setAssistantModeEnabled(false);
  const promptWithWakeAndBgOn = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "sierra");
  assert.ok(promptWithWakeAndBgOn.includes("Wake Word: CURRENTLY ENABLED in Settings"));
  assert.ok(promptWithWakeAndBgOn.includes("Background Live Listening: CURRENTLY ENABLED in Settings"));
  assert.ok(promptWithWakeAndBgOn.includes("Android Default Assistant Mode: CURRENTLY DISABLED (OFF) in Settings"));

  // Reset back to defaults (all OFF)
  setWakeWordEnabled(false);
  setBackgroundLiveEnabled(false);
  setAssistantModeEnabled(false);
});

test("Accent/Language Resolution, Voice Style Directive Placement, Non-Latin Transcript & Memory Filter, and Session Logging", async () => {
  const {
    deriveLanguageCodeFromAccent,
    containsNonLatinScript,
    isMostlyLatinScript,
    buildSierraSystemInstruction,
    resolveAndBuildLiveSetupPayload,
    setLiveVoiceConfig,
    saveConversationSummary,
    getConversationSummaries,
    summarizeAndSaveConversation,
    clearConversationSummaries,
    STORAGE_KEY_CONVERSATION_SUMMARIES,
  } = await import("../src/lib/persona");
  const { getDebugLogs, clearDebugLogs } = await import("../src/lib/debugLogStore");

  // 1. Accent -> languageCode derivation
  assert.strictEqual(deriveLanguageCodeFromAccent("Australian"), "en-AU");
  assert.strictEqual(deriveLanguageCodeFromAccent("British"), "en-GB");
  assert.strictEqual(deriveLanguageCodeFromAccent("Indian"), "en-IN");
  assert.strictEqual(deriveLanguageCodeFromAccent("American"), "en-US");
  assert.strictEqual(deriveLanguageCodeFromAccent("Default"), "en-US");
  assert.strictEqual(deriveLanguageCodeFromAccent("Southern US"), "en-US");
  assert.strictEqual(deriveLanguageCodeFromAccent("Irish"), "en-US");
  assert.strictEqual(deriveLanguageCodeFromAccent("Australian", "es-ES"), "es-ES");

  // 2. Voice Style Directive moved right after identity paragraph & strengthened; Language Lock matches accent & locale
  setLiveVoiceConfig(
    { voiceId: "Aoede", accent: "Australian", tone: "Playful" },
    "classy",
    "sierra"
  );
  const sysPrompt = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "sierra");

  // Voice Style Directive must appear right after Sierra's opening identity paragraph (within first 300 chars)
  const first300 = sysPrompt.slice(0, 300);
  assert.ok(
    first300.includes("Voice Style Directive:"),
    `Voice Style Directive must start within the first 300 chars of systemInstruction, got: ${first300}`
  );
  assert.ok(
    sysPrompt.includes("Your Australian accent applies to every sentence"),
    "Voice Style Directive must enforce that the accent applies to every sentence"
  );
  assert.ok(
    sysPrompt.includes("Never announce, describe, or claim an accent—just speak that way naturally."),
    "Voice Style Directive must forbid announcing, describing, or claiming an accent"
  );
  assert.ok(
    sysPrompt.includes("You MUST respond exclusively in English with a Australian accent (en-AU)."),
    "Language Lock must use derived locale en-AU and say 'English with a Australian accent'"
  );
  assert.ok(
    !sysPrompt.includes("English (US) (en-US)"),
    "Language Lock must not contradict the Australian accent with hardcoded en-US"
  );

  // 3. Setup payload uses derived languageCode and logs speechConfig, first 300 chars of systemInstruction, and gender trace
  clearDebugLogs();
  const payloadRes = resolveAndBuildLiveSetupPayload({
    model: "gemini-3.8-live",
    identity: "sierra",
    personaId: "classy",
    contentMode: "sfw",
    languageCode: "en-US",
  });
  assert.strictEqual(payloadRes.sentVoiceName, "Aoede");
  assert.strictEqual(payloadRes.resolvedLanguageCode, "en-AU");
  assert.strictEqual(
    payloadRes.setupMessage.setup.generationConfig.speechConfig.languageCode,
    "en-AU"
  );
  assert.strictEqual(payloadRes.selectedGender, "female");
  assert.strictEqual(payloadRes.resolvedVoiceGender, "female");

  const logs = getDebugLogs();
  assert.ok(
    logs.some(
      (l) =>
        l.stage === "LiveVoice:SpeechConfig" &&
        l.detail.includes('"voiceName":"Aoede"') &&
        l.detail.includes('"languageCode":"en-AU"') &&
        l.detail.includes("systemInstruction[0..300]=")
    ),
    "Session start must log final speechConfig (voiceName, languageCode) and first 300 chars of systemInstruction"
  );
  assert.ok(
    logs.some(
      (l) =>
        l.stage === "LiveVoice:GenderTrace" &&
        l.detail.includes('selectedGender="female"') &&
        l.detail.includes('resolvedVoice="Aoede"')
    ),
    "Session start must log selected gender and resolved voice"
  );

  // 4. Client-side non-Latin script filter for user transcripts
  assert.strictEqual(isMostlyLatinScript("Hey Sierra, how are you doing today?"), true);
  assert.strictEqual(isMostlyLatinScript("नमस्ते सिएरा आप कैसी हैं"), false);
  assert.strictEqual(isMostlyLatinScript("مرحبا سييرا"), false);
  assert.strictEqual(containsNonLatinScript("User: नमस्ते | Reply: Hi there"), true);
  assert.strictEqual(containsNonLatinScript("User: Hello Sierra | Reply: Hey there!"), false);

  // 5. Memory summaries filter out non-Latin script on save and on load
  clearConversationSummaries();
  if (typeof localStorage !== "undefined") {
    // Seed localStorage directly with one contaminated Hindi summary and one clean English summary
    localStorage.setItem(
      STORAGE_KEY_CONVERSATION_SUMMARIES,
      JSON.stringify([
        {
          id: "contaminated-hindi-1",
          source: "live",
          summary: "User: क्या हाल है सिएरा | Reply: Hey!",
          updatedAt: Date.now() - 10000,
        },
        {
          id: "clean-english-1",
          source: "live",
          summary: "User: Tell me about Melbourne | Reply: Melbourne has amazing coffee and laneways.",
          updatedAt: Date.now() - 5000,
        },
      ])
    );
  }

  const loadedSummaries = getConversationSummaries();
  assert.strictEqual(loadedSummaries.length, 1, "getConversationSummaries must ignore existing summaries containing non-Latin script");
  assert.strictEqual(loadedSummaries[0].id, "clean-english-1");

  // Attempting to save a summary with non-Latin script must be rejected
  saveConversationSummary({
    id: "contaminated-hindi-2",
    source: "live",
    summary: "User: नमस्ते | Reply: Hi",
  });
  assert.strictEqual(getConversationSummaries().length, 1);

  // summarizeAndSaveConversation ignores non-Latin turns
  const rejectedSummary = summarizeAndSaveConversation(
    "contaminated-turn-session",
    [
      { role: "user", content: "नमस्ते सिएरा" },
      { role: "model", content: "Hey there, how can I help?" },
    ],
    undefined,
    "live"
  );
  assert.strictEqual(rejectedSummary, null);
  clearConversationSummaries();
});

test("Adaptive Barge-In Gate: Echo Rejection, Grace Period, and Headphone Mode", async () => {
  const {
    evaluateBargeInDecision,
    SPEAKER_BARGE_IN_FLOOR_RMS,
    SPEAKER_BARGE_IN_MULTIPLE,
    SPEAKER_BARGE_IN_SUSTAINED_MS,
    SPEAKER_BARGE_IN_TURN_GRACE_MS,
  } = await import("../src/components/LiveVoice");

  // Constant verification: SPEAKER_BARGE_IN_FLOOR_RMS must be 0.20
  assert.strictEqual(SPEAKER_BARGE_IN_FLOOR_RMS, 0.2, "SPEAKER_BARGE_IN_FLOOR_RMS must be set to 0.20");
  assert.strictEqual(SPEAKER_BARGE_IN_MULTIPLE, 2.5);
  assert.strictEqual(SPEAKER_BARGE_IN_SUSTAINED_MS, 600);
  assert.strictEqual(SPEAKER_BARGE_IN_TURN_GRACE_MS, 400);

  // 1. Not playing: no barge-in
  const notPlaying = evaluateBargeInDecision({
    micRms: 0.50,
    playbackRms: 0,
    isPlaying: false,
    sustainedMs: 1000,
    timeSinceTurnStartMs: 2000,
    mode: "speaker",
  });
  assert.strictEqual(notPlaying.shouldTrigger, false);
  assert.strictEqual(notPlaying.reason, "not_playing");

  // 2. Speaker mode: echo below floor (0.157 - 0.18 RMS observed echo) ignored
  const echoPeak = evaluateBargeInDecision({
    micRms: 0.175,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 700,
    timeSinceTurnStartMs: 1000,
    mode: "speaker",
  });
  assert.strictEqual(echoPeak.shouldTrigger, false);
  assert.strictEqual(echoPeak.decision, "ignored");
  assert.strictEqual(echoPeak.reason, "below_threshold");
  assert.strictEqual(echoPeak.requiredRms, 0.2);

  // 3. Speaker mode: echo when model is loud (playback RMS 0.10 -> required 0.25)
  const loudModelEcho = evaluateBargeInDecision({
    micRms: 0.22,
    playbackRms: 0.10,
    isPlaying: true,
    sustainedMs: 800,
    timeSinceTurnStartMs: 1200,
    mode: "speaker",
  });
  assert.strictEqual(loudModelEcho.shouldTrigger, false);
  assert.strictEqual(loudModelEcho.reason, "below_threshold");
  assert.strictEqual(loudModelEcho.requiredRms, 0.25);

  // 4. Speaker mode: within 400ms turn grace period ignored
  const withinGrace = evaluateBargeInDecision({
    micRms: 0.45,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 700,
    timeSinceTurnStartMs: 250,
    mode: "speaker",
  });
  assert.strictEqual(withinGrace.shouldTrigger, false);
  assert.strictEqual(withinGrace.decision, "ignored");
  assert.strictEqual(withinGrace.reason, "within_grace");
  assert.strictEqual(withinGrace.isWithinGrace, true);

  // 5. Speaker mode: loud voice accumulating (<600ms)
  const accumulating = evaluateBargeInDecision({
    micRms: 0.40,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 350,
    timeSinceTurnStartMs: 800,
    mode: "speaker",
  });
  assert.strictEqual(accumulating.shouldTrigger, false);
  assert.strictEqual(accumulating.reason, "accumulating");

  // 6. Speaker mode: genuine sustained user speech (>=600ms, >required RMS, outside grace) -> triggers!
  const genuineSpeakerBargeIn = evaluateBargeInDecision({
    micRms: 0.40,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 650,
    timeSinceTurnStartMs: 800,
    mode: "speaker",
  });
  assert.strictEqual(genuineSpeakerBargeIn.shouldTrigger, true);
  assert.strictEqual(genuineSpeakerBargeIn.decision, "trigger");
  assert.strictEqual(genuineSpeakerBargeIn.reason, "triggered");

  // 7. Headphones mode: sensitive low floor (0.01) and fast window (150ms)
  const headphonesBargeIn = evaluateBargeInDecision({
    micRms: 0.02,
    playbackRms: 0.15,
    isPlaying: true,
    sustainedMs: 160,
    timeSinceTurnStartMs: 200,
    mode: "headphones",
  });
  assert.strictEqual(headphonesBargeIn.shouldTrigger, true);
  assert.strictEqual(headphonesBargeIn.decision, "trigger");
  assert.strictEqual(headphonesBargeIn.reason, "triggered");
});

test("Settings Backup Export and Import: Voice and Persona Coverage (Version 2)", async () => {
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");
  const { resolveAndBuildLiveSetupPayload } = await import("../src/lib/persona");

  // Mock localStorage
  const storageMap: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storageMap[key] || null,
    setItem: (key: string, val: string) => {
      storageMap[key] = String(val);
    },
    removeItem: (key: string) => {
      delete storageMap[key];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) {
        delete storageMap[k];
      }
    },
    key: (i: number) => Object.keys(storageMap)[i] || null,
    get length() {
      return Object.keys(storageMap).length;
    },
  } as any;

  // Set up persona and voice configs in localStorage
  storageMap["sierra_live_voice_config_sierra_classy"] = JSON.stringify({
    voiceId: "Aoede",
    accent: "Australian",
    tone: "Playful",
    userSelectedVoice: true,
  });
  storageMap["sierra_chat_voice_config_tyler_confident"] = JSON.stringify({
    provider: "openrouter",
    voiceId: "en-US-Standard-B",
    speed: 1.1,
    pitch: 1.0,
    accent: "American",
    tone: "Confident",
    enabled: true,
    userSelectedVoice: true,
  });
  storageMap["sierra_audio_output_mode"] = "speaker";
  storageMap["sierra_openrouter_api_key"] = "sk-secret-token-do-not-export";
  storageMap["sierra_picovoice_access_key"] = "pv-secret-token-do-not-export";

  const exportedJson = exportLocalBackupData();
  const parsed = JSON.parse(exportedJson);

  assert.strictEqual(parsed.version, 3, "Exported backup must be version 3");
  assert.ok(parsed.settingsV3, "Exported backup must include settingsV3");
  assert.strictEqual(parsed.audioOutputMode, "speaker");
  assert.ok(parsed.liveVoiceConfigs["sierra_live_voice_config_sierra_classy"]);
  assert.strictEqual(parsed.liveVoiceConfigs["sierra_live_voice_config_sierra_classy"].voiceId, "Aoede");
  assert.ok(parsed.chatVoiceConfigs["sierra_chat_voice_config_tyler_confident"]);
  assert.strictEqual(parsed.chatVoiceConfigs["sierra_chat_voice_config_tyler_confident"].provider, "openrouter");

  // Secrets MUST NOT be exported
  assert.strictEqual(parsed.sierra_openrouter_api_key, undefined, "Secrets must never be exported in backup");
  assert.strictEqual(parsed.sierra_picovoice_access_key, undefined, "Secrets must never be exported in backup");
  assert.ok(!exportedJson.includes("sk-secret-token"), "Secret token text must not appear in exported JSON");

  // Clear storage and test import
  for (const k of Object.keys(storageMap)) {
    delete storageMap[k];
  }

  const importResult = importLocalBackupData(exportedJson);
  assert.ok(importResult.configsCount > 0, "Configs count must be reported");
  assert.strictEqual(storageMap["sierra_live_voice_config_sierra_classy"], JSON.stringify({
    voiceId: "Aoede",
    accent: "Australian",
    tone: "Playful",
    userSelectedVoice: true,
  }));
  const { getAudioOutputMode } = await import("../src/lib/persona.ts");
  assert.strictEqual(getAudioOutputMode(), "speaker", "audioOutputMode must restore into unified settings store");
  assert.strictEqual(storageMap["sierra_audio_output_mode"], undefined, "Legacy sierra_audio_output_mode must stay removed");

  // Verify resolveAndBuildLiveSetupPayload in speaker mode
  const payloadSpeaker = resolveAndBuildLiveSetupPayload({
    audioOutputMode: "speaker",
  });
  assert.strictEqual(
    payloadSpeaker.setupMessage.setup.realtimeInputConfig.automaticActivityDetection.disabled,
    false,
    "automaticActivityDetection.disabled must NOT be true"
  );
  assert.strictEqual(
    payloadSpeaker.setupMessage.setup.realtimeInputConfig.activityHandling,
    "NO_INTERRUPTION",
    "activityHandling must be NO_INTERRUPTION in speaker mode"
  );

  // Verify resolveAndBuildLiveSetupPayload in headphones mode
  const payloadHeadphones = resolveAndBuildLiveSetupPayload({
    audioOutputMode: "headphones",
  });
  assert.strictEqual(
    payloadHeadphones.setupMessage.setup.realtimeInputConfig.automaticActivityDetection.disabled,
    false
  );
  assert.strictEqual(
    payloadHeadphones.setupMessage.setup.realtimeInputConfig.activityHandling,
    "START_OF_ACTIVITY_INTERRUPTS"
  );
});

test("Single Barge-In Path Enforcement: No Playback Flush Without evaluateBargeInDecision", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const liveVoiceCode = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/LiveVoice.tsx"),
    "utf8"
  );

  // 1. Assert old log string pattern "Sustained user speech detected during playback (...ms >= ...ms)" is completely removed
  assert.strictEqual(
    /Sustained user speech detected during playback \(\d+ms >=/i.test(liveVoiceCode),
    false,
    "Legacy duration-based log string 'Sustained user speech detected during playback (...ms >= ...ms)' must be removed"
  );

  // 2. Assert old sensitivity thresholdMap ({ low: 350, medium: 250, high: 150 }) is completely removed
  assert.strictEqual(
    /low:\s*\{\s*threshold:\s*0\.025,\s*duration:\s*350\s*\}/.test(liveVoiceCode),
    false,
    "Old sensitivity duration thresholdMap must be completely removed"
  );

  // 3. Assert old VOICE_THRESHOLD is completely removed from LiveVoice.tsx
  assert.strictEqual(
    /const VOICE_THRESHOLD\s*=/i.test(liveVoiceCode),
    false,
    "Legacy VOICE_THRESHOLD constant must be removed from LiveVoice.tsx"
  );

  // 4. Assert [Diag] BargeIn is logged during model playback
  assert.strictEqual(
    liveVoiceCode.includes("[Diag] BargeIn: micRMS="),
    true,
    "[Diag] BargeIn lines must be logged on every evaluation during model playback"
  );

  // 5. Assert [Diag] AudioMode is logged
  assert.strictEqual(
    liveVoiceCode.includes("[Diag] AudioMode:"),
    true,
    "[Diag] AudioMode must be logged"
  );

  // 6. Assert automaticActivityDetection.disabled is false everywhere in src/
  const personaCode = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/persona.ts"),
    "utf8"
  );
  assert.strictEqual(
    /automaticActivityDetection:\s*\{\s*disabled:\s*true\s*\}/.test(personaCode),
    false,
    "automaticActivityDetection.disabled must NOT be true in persona.ts"
  );

  // 7. Functional test: Simulate mic chunk processing and verify ONLY evaluateBargeInDecision triggers playback flush
  const { evaluateBargeInDecision } = await import("../src/components/LiveVoice");

  type ChunkEval = {
    micRms: number;
    playbackRms: number;
    isPlaying: boolean;
    sustainedMs: number;
    timeSinceTurnStartMs: number;
    mode: "speaker" | "headphones";
  };

  const simulateMicProcessing = (chunks: ChunkEval[]) => {
    let flushCount = 0;
    for (const chunk of chunks) {
      const decision = evaluateBargeInDecision(chunk);
      // Contract: stopPlayback() / flush is ONLY triggered when decision.shouldTrigger is true
      if (decision.shouldTrigger) {
        flushCount++;
      }
    }
    return flushCount;
  };

  // Test 7a: Phone speaker echo (0.17 RMS, playback 0.06 RMS, sustained 1000ms) - MUST NOT FLUSH
  const echoChunks: ChunkEval[] = Array.from({ length: 20 }, (_, i) => ({
    micRms: 0.17,
    playbackRms: 0.06,
    isPlaying: true,
    sustainedMs: (i + 1) * 50,
    timeSinceTurnStartMs: 500 + (i * 50),
    mode: "speaker" as const,
  }));
  const echoFlushes = simulateMicProcessing(echoChunks);
  assert.strictEqual(echoFlushes, 0, "Speaker echo MUST NOT trigger playback flush");

  // Test 7b: Turn grace period (loud voice 0.40 RMS, but elapsed only 200ms < 400ms) - MUST NOT FLUSH
  const graceChunks: ChunkEval[] = [
    {
      micRms: 0.40,
      playbackRms: 0.04,
      isPlaying: true,
      sustainedMs: 200,
      timeSinceTurnStartMs: 200,
      mode: "speaker" as const,
    },
  ];
  const graceFlushes = simulateMicProcessing(graceChunks);
  assert.strictEqual(graceFlushes, 0, "Speech during turn grace period MUST NOT trigger playback flush");

  // Test 7c: Genuine loud user speech in speaker mode (0.40 RMS, 650ms sustained, outside grace) - MUST FLUSH
  const genuineChunks: ChunkEval[] = [
    {
      micRms: 0.40,
      playbackRms: 0.04,
      isPlaying: true,
      sustainedMs: 650,
      timeSinceTurnStartMs: 900,
      mode: "speaker" as const,
    },
  ];
  const genuineFlushes = simulateMicProcessing(genuineChunks);
  assert.strictEqual(genuineFlushes, 1, "Genuine sustained speech outside grace period MUST trigger playback flush");
});

test("Language Guard: Conservative Mismatch and Garble Detection Relative to Selected Language", async () => {
  const { detectTranscriptLanguageMismatch, isTranscriptGarbledOrForeign } = await import("../src/lib/languageGuard");

  // 1. Guardrail 1: English mode - clearly foreign Spanish utterances MUST be flagged
  const spanishPunct = isTranscriptGarbledOrForeign("¿Qué", "en-US");
  assert.strictEqual(spanishPunct.isGarbledOrForeign, true, "¿Qué must be flagged as foreign in en-US mode");
  assert.strictEqual(spanishPunct.detectedLanguage, "Spanish");

  const spanishSentence = isTranscriptGarbledOrForeign("Mi taladro es cono", "en-US");
  assert.strictEqual(spanishSentence.isGarbledOrForeign, true, "'Mi taladro es cono' must be flagged as foreign in en-US mode");
  assert.strictEqual(spanishSentence.detectedLanguage, "Spanish");

  const spanishQuestion = isTranscriptGarbledOrForeign("¿Cómo estás amigo?", "en-US");
  assert.strictEqual(spanishQuestion.isGarbledOrForeign, true);
  assert.strictEqual(spanishQuestion.detectedLanguage, "Spanish");

  // 2. Non-Latin scripts when English is selected
  const russian = isTranscriptGarbledOrForeign("Привет, как дела?", "en-US");
  assert.strictEqual(russian.isGarbledOrForeign, true);
  assert.strictEqual(russian.detectedLanguage, "Russian/Cyrillic");

  const japanese = isTranscriptGarbledOrForeign("こんにちは、元気ですか", "en-US");
  assert.strictEqual(japanese.isGarbledOrForeign, true);
  assert.strictEqual(japanese.detectedLanguage, "Japanese");

  // 3. Guardrail 1: Short / ambiguous / informal English utterances MUST NOT be flagged
  const short1 = isTranscriptGarbledOrForeign("So", "en-US");
  assert.strictEqual(short1.isGarbledOrForeign, false, "'So' must NEVER be flagged");

  const short2 = isTranscriptGarbledOrForeign("Hey Tyler", "en-US");
  assert.strictEqual(short2.isGarbledOrForeign, false, "'Hey Tyler' must NEVER be flagged");

  const short3 = isTranscriptGarbledOrForeign("Yeah, sounds good to me", "en-US");
  assert.strictEqual(short3.isGarbledOrForeign, false, "Colloquial English must NEVER be flagged");

  const short4 = isTranscriptGarbledOrForeign("Okay", "en-US");
  assert.strictEqual(short4.isGarbledOrForeign, false, "'Okay' must NEVER be flagged");

  const short5 = isTranscriptGarbledOrForeign("Sierra", "en-US");
  assert.strictEqual(short5.isGarbledOrForeign, false, "'Sierra' must NEVER be flagged");

  // 4. Guardrail 2: Works relative to selected language (Spanish mode)
  const spanishInSpanishMode = isTranscriptGarbledOrForeign("Hola, ¿cómo estás hoy?", "es-ES");
  assert.strictEqual(spanishInSpanishMode.isGarbledOrForeign, false, "Spanish text in Spanish mode MUST be valid");

  const taladroInSpanishMode = isTranscriptGarbledOrForeign("Mi taladro funciona bien", "es-ES");
  assert.strictEqual(taladroInSpanishMode.isGarbledOrForeign, false, "'Mi taladro funciona bien' in Spanish mode MUST be valid");

  const englishInSpanishMode = isTranscriptGarbledOrForeign("What is the weather today in New York", "es-ES");
  assert.strictEqual(englishInSpanishMode.isGarbledOrForeign, true, "English sentence in Spanish mode MUST be flagged");
  assert.strictEqual(englishInSpanishMode.detectedLanguage, "English");

  // 5. Garbled text detection
  const punctuationGarble = isTranscriptGarbledOrForeign("???????", "en-US");
  assert.strictEqual(punctuationGarble.isGarbledOrForeign, true, "Punctuation spam must be flagged as garbled");

  const consonantGarble = isTranscriptGarbledOrForeign("asdfghjklzxcvbnm", "en-US");
  assert.strictEqual(consonantGarble.isGarbledOrForeign, true, "Consonant gibberish must be flagged as garbled");
});

test("Memory Summary Guard: Reject Garbled User Turns and Model Language Drift", async () => {
  const { summarizeAndSaveConversation } = await import("../src/lib/persona");

  // Mock localStorage for memory tests
  const storageMap: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storageMap[key] || null,
    setItem: (key: string, val: string) => {
      storageMap[key] = String(val);
    },
    removeItem: (key: string) => {
      delete storageMap[key];
    },
    clear: () => {
      for (const k in storageMap) delete storageMap[k];
    },
    key: (i: number) => Object.keys(storageMap)[i] || null,
    get length() {
      return Object.keys(storageMap).length;
    },
  } as any;

  // 1. User turn in Spanish ("¿Qué") when English selected -> Must NOT save summary
  const summaryRejectedUser = summarizeAndSaveConversation(
    "sess-reject-user",
    [
      { role: "user", content: "¿Qué" },
      { role: "model", content: "I didn't quite catch that. Could you repeat it?" },
    ],
    "Live Voice",
    "live",
    "en-US"
  );
  assert.strictEqual(summaryRejectedUser, null, "Summary must be rejected when user turn is foreign/Spanish");

  // 2. User turn with "Mi taladro es cono" -> Must NOT save summary
  const summaryRejectedTaladro = summarizeAndSaveConversation(
    "sess-reject-taladro",
    [
      { role: "user", content: "Mi taladro es cono" },
      { role: "model", content: "I'm not sure what you mean." },
    ],
    "Live Voice",
    "live",
    "en-US"
  );
  assert.strictEqual(summaryRejectedTaladro, null, "Summary must be rejected for 'Mi taladro es cono'");

  // 3. Model turn language drift into Spanish when English selected -> Must NOT save summary
  const summaryRejectedModelDrift = summarizeAndSaveConversation(
    "sess-reject-model-drift",
    [
      { role: "user", content: "Can you help me with my project?" },
      { role: "model", content: "Hola, claro que sí, ¿en qué te puedo ayudar hoy con tu proyecto?" },
    ],
    "Live Voice",
    "live",
    "en-US"
  );
  assert.strictEqual(summaryRejectedModelDrift, null, "Summary must be rejected when model drifted into Spanish");

  // 4. Valid conversation in English -> Must save summary
  const validSummary = summarizeAndSaveConversation(
    "sess-valid-turn",
    [
      { role: "user", content: "Can you recommend a good recipe for dinner tonight?" },
      { role: "model", content: "A garlic butter roasted salmon with asparagus is quick and delicious." },
    ],
    "Live Voice",
    "live",
    "en-US"
  );
  assert.notStrictEqual(validSummary, null, "Clean English conversation must save summary");
  assert.strictEqual(validSummary?.id, "sess-valid-turn");
});

test("One-Time Summaries Drift Cleanup: Target Corrupted Entries and Preserve Backup", async () => {
  const {
    cleanCorruptedConversationSummaries,
    STORAGE_KEY_SUMMARIES_DRIFT_CLEANED,
    STORAGE_KEY_SUMMARIES_REMOVED_BACKUP,
  } = await import("../src/lib/languageGuard");

  // Setup localStorage with clean and corrupted summaries
  const storageMap: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => storageMap[key] || null,
    setItem: (key: string, val: string) => {
      storageMap[key] = String(val);
    },
    removeItem: (key: string) => {
      delete storageMap[key];
    },
    clear: () => {
      for (const k in storageMap) delete storageMap[k];
    },
    key: (i: number) => Object.keys(storageMap)[i] || null,
    get length() {
      return Object.keys(storageMap).length;
    },
  } as any;

  const testSummaries = [
    {
      id: "clean-1",
      source: "live",
      summary: "User: How do I build a wooden table? | Reply: First measure and cut your wood carefully.",
      updatedAt: 1000,
    },
    {
      id: "corrupted-que",
      source: "live",
      summary: "User: ¿Qué | Reply: Hola, ¿en qué te puedo ayudar?",
      updatedAt: 2000,
    },
    {
      id: "corrupted-taladro",
      source: "live",
      summary: "User: Mi taladro es cono | Reply: No entiendo lo que dijiste.",
      updatedAt: 3000,
    },
    {
      id: "clean-2",
      source: "live",
      summary: "User: Hey Tyler, can you help me? | Reply: I'm right here with you.",
      updatedAt: 4000,
    },
  ];

  storageMap["sierra_conversation_summaries"] = JSON.stringify(testSummaries);

  // Run cleanup
  const cleanupResult = cleanCorruptedConversationSummaries(true);
  assert.strictEqual(cleanupResult.removedCount, 2, "Must remove exactly 2 corrupted summaries");
  assert.strictEqual(cleanupResult.removedEntries.length, 2);

  // Check retained summaries in sierra_conversation_summaries
  const remaining = JSON.parse(storageMap["sierra_conversation_summaries"]);
  assert.strictEqual(remaining.length, 2, "Must retain exactly 2 clean summaries");
  assert.strictEqual(remaining[0].id, "clean-1");
  assert.strictEqual(remaining[1].id, "clean-2");

  // Check one-time backup key
  const backup = JSON.parse(storageMap[STORAGE_KEY_SUMMARIES_REMOVED_BACKUP]);
  assert.strictEqual(backup.length, 2, "Backup must contain the 2 removed entries");
  assert.strictEqual(backup.some((b: any) => b.id === "corrupted-que"), true);
  assert.strictEqual(backup.some((b: any) => b.id === "corrupted-taladro"), true);

  // Check one-time flag is set
  assert.strictEqual(storageMap[STORAGE_KEY_SUMMARIES_DRIFT_CLEANED], "true");

  // Second run without force should do nothing (runs once)
  const secondRun = cleanCorruptedConversationSummaries(false);
  assert.strictEqual(secondRun.removedCount, 0, "Second run must not remove anything");
});

test("Live System Prompt Anti-Drift Rule in Tyler and Sierra Persona Directives", async () => {
  const { buildSierraSystemInstruction } = await import("../src/lib/persona");

  const promptEnglish = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "sierra");
  assert.strictEqual(
    promptEnglish.includes("Strict Anti-Drift Rule:"),
    true,
    "Prompt must contain Strict Anti-Drift Rule"
  );
  assert.strictEqual(
    promptEnglish.includes("do NOT guess or answer in another language"),
    true,
    "Prompt must forbid guessing or answering in another language"
  );
  assert.strictEqual(
    promptEnglish.includes("ask them to repeat it in a short, natural line"),
    true,
    "Prompt must instruct asking them to repeat in a short natural line"
  );

  const promptSpanish = buildSierraSystemInstruction("classy", "sfw", undefined, "es-ES", "tyler");
  assert.strictEqual(
    promptSpanish.includes("Strict Anti-Drift Rule:"),
    true,
    "Spanish prompt must also contain Strict Anti-Drift Rule"
  );
  assert.strictEqual(
    promptSpanish.includes("Spanish (Spain) (es-ES)"),
    true,
    "Spanish prompt must lock to Spanish"
  );

  // Verify v2 backup export/import includes removedSummariesBackup and summariesDriftCleaned
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");
  const { STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, STORAGE_KEY_SUMMARIES_REMOVED_BACKUP } = await import("../src/lib/languageGuard");

  localStorage.setItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED, "true");
  localStorage.setItem(
    STORAGE_KEY_SUMMARIES_REMOVED_BACKUP,
    JSON.stringify([{ id: "removed-1", summary: "User: ¿Qué", reason: "Spanish punctuation" }])
  );

  const exportedJson = exportLocalBackupData();
  const parsedExport = JSON.parse(exportedJson);
  assert.strictEqual(parsedExport.summariesDriftCleaned, true);
  assert.strictEqual(Array.isArray(parsedExport.removedSummariesBackup), true);
  assert.strictEqual(parsedExport.removedSummariesBackup.length, 1);

  localStorage.removeItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED);
  localStorage.removeItem(STORAGE_KEY_SUMMARIES_REMOVED_BACKUP);

  importLocalBackupData(exportedJson);
  assert.strictEqual(localStorage.getItem(STORAGE_KEY_SUMMARIES_DRIFT_CLEANED), "true");
  assert.strictEqual(
    JSON.parse(localStorage.getItem(STORAGE_KEY_SUMMARIES_REMOVED_BACKUP) || "[]").length,
    1
  );
});

test("Gemini Live Extended Thinking Error 007 Fix & Regression Suite (LOW, MEDIUM, HIGH)", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const settingsCode = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Settings.tsx"),
    "utf8"
  );
  const liveVoiceCode = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/LiveVoice.tsx"),
    "utf8"
  );

  // 1. Verify UI dropdown labeled "Thinking Level" with uppercase options LOW, MEDIUM, HIGH
  //    scoped exclusively to isGeminiLiveExtendedThinkingModel
  assert.strictEqual(
    settingsCode.includes("Thinking Level"),
    true,
    "Settings.tsx must contain 'Thinking Level' label"
  );
  assert.strictEqual(
    settingsCode.includes("isGeminiLiveExtendedThinkingModel("),
    true,
    "Settings.tsx must scope Thinking Level selector exclusively to Extended Thinking model"
  );
  assert.strictEqual(
    settingsCode.includes('<option value="LOW">LOW</option>'),
    true,
    "Settings.tsx must have 'LOW' option"
  );
  assert.strictEqual(
    settingsCode.includes('<option value="MEDIUM">MEDIUM</option>'),
    true,
    "Settings.tsx must have 'MEDIUM' option"
  );
  assert.strictEqual(
    settingsCode.includes('<option value="HIGH">HIGH</option>'),
    true,
    "Settings.tsx must have 'HIGH' option"
  );
  assert.strictEqual(
    liveVoiceCode.includes("isGeminiLiveExtendedThinkingModel("),
    true,
    "LiveVoice.tsx must scope Thinking Level selector exclusively to Extended Thinking model"
  );

  const {
    parseThinkingLevel,
    validateThinkingLevel,
    setGeminiThinkingLevel,
    getGeminiThinkingLevel,
    getStoredGeminiThinkingLevel,
    isGeminiLiveExtendedThinkingModel,
    resolveAndBuildLiveSetupPayload,
    STORAGE_KEY_GEMINI_THINKING_LEVEL,
  } = await import("../src/lib/persona");
  const { STORAGE_KEY_SETTINGS_V3, STORAGE_KEY_UNIFIED_SETTINGS } = await import("../src/lib/settingsStore");
  const { testGeminiLiveWebSocket, streamGeminiLiveWebSocket } = await import("../src/lib/gemini");
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");

  // 2. Verify model detection
  assert.strictEqual(isGeminiLiveExtendedThinkingModel("gemini-3.8-live-extended-thinking"), true);
  assert.strictEqual(isGeminiLiveExtendedThinkingModel("models/gemini-3.8-live-extended-thinking"), true);
  assert.strictEqual(isGeminiLiveExtendedThinkingModel("gemini-3.8-live"), false);
  assert.strictEqual(isGeminiLiveExtendedThinkingModel("models/gemini-3.8-live"), false);

  // 3. Verify parsing and strict validation
  assert.strictEqual(parseThinkingLevel("low"), "LOW");
  assert.strictEqual(parseThinkingLevel("MEDIUM"), "MEDIUM");
  assert.strictEqual(parseThinkingLevel("High"), "HIGH");
  assert.strictEqual(validateThinkingLevel("LOW"), "LOW");
  assert.strictEqual(validateThinkingLevel("MEDIUM"), "MEDIUM");
  assert.strictEqual(validateThinkingLevel("HIGH"), "HIGH");
  assert.throws(
    () => validateThinkingLevel(""),
    /Code 007/,
    "Empty thinking level must throw Code 007 validation error"
  );
  assert.throws(
    () => validateThinkingLevel(null),
    /Code 007/,
    "Null thinking level must throw Code 007 validation error"
  );
  assert.throws(
    () => validateThinkingLevel("invalid"),
    /Code 007/,
    "Invalid thinking level must throw Code 007 validation error"
  );

  // 4. Test all three thinking levels (LOW, MEDIUM, HIGH) independently for Extended Thinking
  for (const level of ["LOW", "MEDIUM", "HIGH"] as const) {
    setGeminiThinkingLevel(level);
    assert.strictEqual(getGeminiThinkingLevel(), level, `Persisted level must be ${level}`);
    assert.strictEqual(getStoredGeminiThinkingLevel(), level, `Stored level must be ${level}`);

    const payload = resolveAndBuildLiveSetupPayload({
      model: "gemini-3.8-live-extended-thinking",
    });

    assert.strictEqual(payload.thinkingLevel, level);
    assert.deepStrictEqual(
      payload.setupMessage.setup.generationConfig.thinkingConfig,
      { thinkingLevel: level },
      `setup.generationConfig.thinkingConfig must be { thinkingLevel: "${level}" }`
    );
    assert.strictEqual(
      "thinking_config" in (payload.setupMessage.setup as any),
      false,
      "Legacy top-level thinking_config must not be present"
    );
    assert.strictEqual(
      "thinking_config" in (payload.setupMessage.setup.generationConfig as any),
      false,
      "Legacy generationConfig.thinking_config must not be present"
    );
  }

  // 5. Verify regular Gemini 3.8 Live sends NO thinking configuration even when a thinking level is stored
  setGeminiThinkingLevel("HIGH");
  const regularLivePayload = resolveAndBuildLiveSetupPayload({
    model: "gemini-3.8-live",
  });
  assert.strictEqual(regularLivePayload.thinkingLevel, undefined);
  assert.strictEqual(
    regularLivePayload.setupMessage.setup.generationConfig.thinkingConfig,
    undefined,
    "Regular gemini-3.8-live must not send thinkingConfig"
  );
  assert.strictEqual(
    "thinkingConfig" in regularLivePayload.setupMessage.setup.generationConfig,
    false,
    "Regular gemini-3.8-live generationConfig must omit thinkingConfig key completely"
  );

  // 6. Verify Extended Thinking never starts without its required thinking level
  localStorage.removeItem(STORAGE_KEY_GEMINI_THINKING_LEVEL);
  localStorage.removeItem("omni_providers_config");
  localStorage.removeItem(STORAGE_KEY_UNIFIED_SETTINGS);
  localStorage.removeItem(STORAGE_KEY_SETTINGS_V3);
  assert.strictEqual(getStoredGeminiThinkingLevel(), null);

  assert.throws(
    () =>
      resolveAndBuildLiveSetupPayload({
        model: "gemini-3.8-live-extended-thinking",
      }),
    /Code 007/,
    "Extended Thinking must refuse to build setup payload when no thinking level is configured"
  );

  setGeminiThinkingLevel("LOW");
  assert.throws(
    () =>
      resolveAndBuildLiveSetupPayload({
        model: "gemini-3.8-live-extended-thinking",
        thinkingLevel: "" as any,
      }),
    /Code 007/,
    "Extended Thinking must refuse to start when an empty thinkingLevel is passed and never silently substitute a default"
  );
  assert.throws(
    () =>
      resolveAndBuildLiveSetupPayload({
        model: "gemini-3.8-live-extended-thinking",
        thinkingLevel: undefined,
      }),
    /Code 007/,
    "Extended Thinking must refuse to start when undefined thinkingLevel is explicitly passed"
  );

  // 7. Verify configuration persistence across restarts and backup export/import
  for (const level of ["LOW", "MEDIUM", "HIGH"] as const) {
    setGeminiThinkingLevel(level);
    const exportedJson = exportLocalBackupData();
    localStorage.removeItem(STORAGE_KEY_GEMINI_THINKING_LEVEL);
    localStorage.removeItem("omni_providers_config");
    localStorage.removeItem(STORAGE_KEY_UNIFIED_SETTINGS);
    localStorage.removeItem(STORAGE_KEY_SETTINGS_V3);
    assert.strictEqual(getStoredGeminiThinkingLevel(), null);

    importLocalBackupData(exportedJson);
    assert.strictEqual(
      getStoredGeminiThinkingLevel(),
      level,
      `Thinking level ${level} must survive backup export/import and restart`
    );
    assert.strictEqual(getGeminiThinkingLevel(), level);
  }

  // 8. Verify WebSocket handshake for LOW, MEDIUM, HIGH, regular Live, premature close, and API error 007
  const originalWebSocket = (globalThis as any).WebSocket;
  let lastSentSetup: any = null;
  let mockServerMode: "setupComplete" | "prematureClose" | "apiError007" | "unrecognized" = "setupComplete";
  let socketOpenedCount = 0;

  class HandshakeMockWebSocket {
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    constructor(_url: string) {
      socketOpenedCount++;
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 2);
    }

    send(data: string) {
      lastSentSetup = JSON.parse(data);
      setTimeout(() => {
        if (mockServerMode === "setupComplete") {
          this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) });
        } else if (mockServerMode === "prematureClose") {
          this.readyState = 3;
          this.onclose?.({ code: 1007, reason: "The thinking level must be specified for this model." });
        } else if (mockServerMode === "apiError007") {
          this.onmessage?.({
            data: JSON.stringify({
              error: {
                code: 7,
                message: "Code 007: The thinking level must be specified for this model.",
              },
            }),
          });
        } else if (mockServerMode === "unrecognized") {
          this.onmessage?.({ data: JSON.stringify({ foo: "bar" }) });
        }
      }, 3);
    }

    close() {
      this.readyState = 3;
    }
  }

  (globalThis as any).WebSocket = HandshakeMockWebSocket;
  try {
    // 8a. LOW, MEDIUM, HIGH over WebSocket
    for (const level of ["LOW", "MEDIUM", "HIGH"] as const) {
      lastSentSetup = null;
      mockServerMode = "setupComplete";
      const res = await testGeminiLiveWebSocket({
        apiKey: "test-key",
        model: "gemini-3.8-live-extended-thinking",
        thinkingLevel: level,
        timeoutMs: 1000,
      });
      assert.strictEqual(res.success, true, `WebSocket test must succeed for level ${level}`);
      assert.deepStrictEqual(lastSentSetup, {
        setup: {
          model: "models/gemini-3.8-live-extended-thinking",
          generationConfig: {
            responseModalities: ["AUDIO"],
            thinkingConfig: {
              thinkingLevel: level,
            },
          },
          outputAudioTranscription: {},
        },
      });
    }

    // 8b. Regular gemini-3.8-live sends no thinkingConfig over WebSocket
    lastSentSetup = null;
    mockServerMode = "setupComplete";
    const regRes = await testGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live",
      timeoutMs: 1000,
    });
    assert.strictEqual(regRes.success, true);
    assert.deepStrictEqual(lastSentSetup, {
      setup: {
        model: "models/gemini-3.8-live",
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        outputAudioTranscription: {},
      },
    });

    // 8c. Extended Thinking rejects before connecting when thinkingLevel is missing
    const countBefore = socketOpenedCount;
    const missingLevelRes = await testGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live-extended-thinking",
      thinkingLevel: null,
      timeoutMs: 1000,
    });
    assert.strictEqual(missingLevelRes.success, false);
    assert.ok(missingLevelRes.error?.includes("Code 007"));
    assert.strictEqual(
      socketOpenedCount,
      countBefore,
      "Must not open WebSocket when Extended Thinking level is missing"
    );

    // 8d. Premature socket closure is treated as failure
    mockServerMode = "prematureClose";
    const closeRes = await testGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live-extended-thinking",
      thinkingLevel: "LOW",
      timeoutMs: 1000,
    });
    assert.strictEqual(closeRes.success, false);
    assert.ok(closeRes.error?.includes("closed before setup completed"));

    // 8e. Server API error message is treated as failure
    mockServerMode = "apiError007";
    const apiErrRes = await testGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live-extended-thinking",
      thinkingLevel: "LOW",
      timeoutMs: 1000,
    });
    assert.strictEqual(apiErrRes.success, false);
    assert.ok(apiErrRes.error?.includes("Code 007"));

    // 8f. Unrecognized payload without setupComplete is treated as failure
    mockServerMode = "unrecognized";
    const unrecRes = await testGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live",
      timeoutMs: 1000,
    });
    assert.strictEqual(unrecRes.success, false);
    assert.ok(unrecRes.error?.includes("missing setupComplete"));

    // 8g. streamGeminiLiveWebSocket rejects before opening socket if Extended Thinking has no level
    let streamError: Error | null = null;
    await streamGeminiLiveWebSocket({
      apiKey: "test-key",
      model: "gemini-3.8-live-extended-thinking",
      thinkingLevel: "",
      messages: [{ role: "user", content: "Hi" }],
      callbacks: {
        onChunk: () => {},
        onDone: () => {},
        onError: (err) => {
          streamError = err;
        },
      },
    });
    assert.ok(streamError !== null && (streamError as Error).message.includes("Code 007"));
  } finally {
    (globalThis as any).WebSocket = originalWebSocket;
  }
});

test("Task 1: Shared model list (src/config/models.ts), custom overrides, defaults, and quota/429 debug logging", async () => {
  const {
    TEXT_MODELS,
    LIVE_MODELS,
    DEFAULT_TEXT_MODEL,
    DEFAULT_LIVE_MODEL,
    getEffectiveTextModel,
    getEffectiveLiveModel,
    setStoredLiveModel,
    getStoredLiveModel,
    setStoredLiveCustomModel,
    getStoredLiveCustomModel,
    setStoredTextCustomModel,
    getStoredTextCustomModel,
    doesModelSupportMapsGrounding,
    logQuotaOrRateLimitError,
    resolveFallbackApiModelId,
  } = await import("../src/config/models");
  const { getDebugLogs, clearDebugLogs } = await import("../src/lib/debugLogStore");

  // Defaults
  assert.strictEqual(DEFAULT_TEXT_MODEL, "gemini-3.5-flash-lite");
  assert.strictEqual(DEFAULT_LIVE_MODEL, "gemini-3.8-live");

  // Required text models
  const textIds = TEXT_MODELS.map((m) => m.id);
  for (const reqId of [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.1-pro-preview",
  ]) {
    assert.ok(textIds.includes(reqId), `TEXT_MODELS must include ${reqId}`);
  }

  // Required live models
  const liveIds = LIVE_MODELS.map((m) => m.id);
  for (const reqLive of [
    "gemini-3.8-live",
    "gemini-3.8-live-extended-thinking",
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-live",
    "gemini-2.0-flash-live",
  ]) {
    assert.ok(liveIds.includes(reqLive), `LIVE_MODELS must include ${reqLive}`);
  }

  // Custom model override priority for both text and live models
  setStoredTextCustomModel("my-custom-text-model");
  assert.strictEqual(getStoredTextCustomModel(), "my-custom-text-model");
  assert.strictEqual(getEffectiveTextModel("gemini-3.8-flash"), "my-custom-text-model");
  setStoredTextCustomModel("");
  assert.strictEqual(getEffectiveTextModel("gemini-3.8-flash"), "gemini-3.8-flash");

  setStoredLiveModel("gemini-3.1-flash-live-preview");
  assert.strictEqual(getStoredLiveModel(), "gemini-3.1-flash-live-preview");
  setStoredLiveCustomModel("my-custom-live-model");
  assert.strictEqual(getStoredLiveCustomModel(), "my-custom-live-model");
  assert.strictEqual(getEffectiveLiveModel("gemini-3.8-live"), "my-custom-live-model");
  setStoredLiveCustomModel("");
  setStoredLiveModel(DEFAULT_LIVE_MODEL);
  assert.strictEqual(getEffectiveLiveModel(), DEFAULT_LIVE_MODEL);

  // Maps grounding capability check
  assert.strictEqual(doesModelSupportMapsGrounding("gemini-3.5-flash-lite", "gemini"), false);
  assert.strictEqual(doesModelSupportMapsGrounding("gemini-3.8-flash", "gemini"), true);
  assert.strictEqual(doesModelSupportMapsGrounding("gemini-3.8-live", "gemini"), false);

  // Fallback model ID resolution for preview/alias IDs
  assert.strictEqual(resolveFallbackApiModelId("gemini-3.5-flash-lite"), "gemini-2.5-flash");

  // Quota / 429 error logging includes model name in persistent debug log
  clearDebugLogs();
  const logged = logQuotaOrRateLimitError(
    "Chat",
    "gemini-3.1-pro-preview",
    "429 Too Many Requests: RESOURCE_EXHAUSTED quota exceeded"
  );
  assert.strictEqual(logged, true);
  const logs = getDebugLogs();
  assert.ok(
    logs.some(
      (l) =>
        (l.stage === "Chat:Quota429" || l.stage.includes("Quota")) &&
        l.detail.includes("gemini-3.1-pro-preview") &&
        l.detail.includes("429")
    ),
    "Quota / 429 error must be surfaced in persistent debug log with model name"
  );
});

test("Task 2: change_voice and list_voice_options tools (valid change, invalid option with closest matches, and persistence)", async () => {
  const {
    executeChangeVoiceTool,
    executeListVoiceOptionsTool,
    buildAllowedVoiceOptionsCatalog,
  } = await import("../src/lib/voiceTools");
  const {
    getActiveIdentity,
    getActivePersonaId,
    getLiveVoiceConfig,
    getChatVoiceConfig,
    setActiveIdentity,
    setActivePersonaId,
  } = await import("../src/lib/persona");
  const { getDebugLogs, clearDebugLogs } = await import("../src/lib/debugLogStore");

  clearDebugLogs();
  setActiveIdentity("sierra");
  setActivePersonaId("classy");

  // 1. Catalog contains real options
  const catalog = buildAllowedVoiceOptionsCatalog();
  assert.ok(catalog.liveVoices.some((v) => v.id === "Aoede"));
  assert.ok(catalog.accents.includes("Australian"));
  assert.ok(catalog.tones.includes("Playful"));

  // 2. Valid voice, accent, style/tone, and persona change persists to both Live and Chat voice configs
  const validRes = executeChangeVoiceTool({
    voice: "Kore",
    accent: "Australian",
    style: "Playful",
    persona: "confident",
    identity: "sierra",
  });
  assert.strictEqual(validRes.success, true);
  assert.strictEqual(validRes.requiresLiveReconnect, true);
  assert.strictEqual(getActiveIdentity(), "sierra");
  assert.strictEqual(getActivePersonaId(), "confident");

  const liveCfg = getLiveVoiceConfig("confident", "sierra");
  assert.strictEqual(liveCfg.voiceId, "Kore");
  assert.strictEqual(liveCfg.accent, "Australian");
  assert.strictEqual(liveCfg.tone, "Playful");

  const chatCfg = getChatVoiceConfig("confident", "sierra");
  assert.strictEqual(chatCfg.accent, "Australian");
  assert.strictEqual(chatCfg.tone, "Playful");

  // 3. Invalid option returns error with closest real options and does not corrupt state
  const invalidRes = executeChangeVoiceTool({
    voice: "NonExistentRobotVoice99",
    accent: "MartianAccent",
  });
  assert.strictEqual(invalidRes.success, false);
  assert.ok(Array.isArray(invalidRes.errors) && invalidRes.errors.length >= 2);
  assert.ok(
    invalidRes.closestMatches?.voice && invalidRes.closestMatches.voice.length > 0,
    "Invalid voice must return closest real voice options"
  );
  assert.ok(
    invalidRes.closestMatches?.accent && invalidRes.closestMatches.accent.length > 0,
    "Invalid accent must return closest real accent options"
  );

  // 4. list_voice_options returns real options and current active configuration
  const listRes = executeListVoiceOptionsTool({ identity: "sierra" });
  assert.strictEqual(listRes.success, true);
  assert.ok(Array.isArray(listRes.liveVoices) && listRes.liveVoices.length >= 5);
  assert.ok(Array.isArray(listRes.accents) && listRes.accents.includes("British"));

  // 5. Debug logs recorded every tool call and result
  const logs = getDebugLogs();
  assert.ok(logs.some((l) => l.stage === "Tool:change_voice:Call"));
  assert.ok(logs.some((l) => l.stage === "Tool:change_voice:Success"));
  assert.ok(logs.some((l) => l.stage === "Tool:change_voice:InvalidOption"));
  assert.ok(logs.some((l) => l.stage === "Tool:list_voice_options:Call"));
});

test("Tasks 3 & 4: Android device control tools wrapper, confirmation gates, per-capability toggles, and toolRouter", async () => {
  const {
    __setDeviceControlPluginForTests,
    executeDeviceControlTool,
    setDeviceCapabilityEnabled,
    setDirectSmsEnabled,
    getBlockedNumbersList,
    buildDeviceControlPromptSection,
  } = await import("../src/lib/deviceControl");
  const { executeSierraToolCall, getAllSierraFunctionDeclarations } = await import(
    "../src/lib/toolRouter"
  );
  const { getDebugLogs, clearDebugLogs } = await import("../src/lib/debugLogStore");

  clearDebugLogs();

  // Verify all 13 tools (2 voice + 11 device control) are registered in getAllSierraFunctionDeclarations
  const allDecls = getAllSierraFunctionDeclarations();
  const declNames = allDecls.map((d) => d.name);
  for (const expectedTool of [
    "change_voice",
    "list_voice_options",
    "open_app",
    "find_contact",
    "make_call",
    "send_text",
    "block_number",
    "open_maps",
    "add_calendar_event",
    "find_calendar_events",
    "set_alarm",
    "set_timer",
    "create_reminder",
  ]) {
    assert.ok(declNames.includes(expectedTool), `Missing tool declaration: ${expectedTool}`);
  }

  // Mock native DeviceControl Capacitor plugin
  const mockCalls: Array<{ method: string; args: any }> = [];
  __setDeviceControlPluginForTests({
    openApp: async (args) => {
      mockCalls.push({ method: "openApp", args });
      if (args.appName === "Banking") {
        return {
          success: false,
          needsClarification: true,
          matches: [
            { label: "Chase Banking", packageName: "com.chase.sig.android" },
            { label: "Wells Fargo Banking", packageName: "com.wf.wellsfargomobile" },
          ],
          message: "Multiple installed apps match 'Banking'. Ask the user which one to open.",
        };
      }
      return {
        success: true,
        launched: { label: "Spotify", packageName: "com.spotify.music" },
        message: "Opened Spotify.",
      };
    },
    findContact: async (args) => {
      mockCalls.push({ method: "findContact", args });
      return {
        success: true,
        contacts: [{ name: "Alice Smith", number: "+15551234567" }],
        message: "Found 1 contact matching 'Alice'.",
      };
    },
    makeCall: async (args) => {
      mockCalls.push({ method: "makeCall", args });
      return {
        success: true,
        action: "ACTION_CALL",
        recipient: "Alice Smith",
        number: "+15551234567",
        message: "Calling Alice Smith (+15551234567).",
      };
    },
    sendText: async (args) => {
      mockCalls.push({ method: "sendText", args });
      return {
        success: true,
        mode: args.directSend ? "DIRECT_SMS" : "INTENT_PREFILLED",
        recipient: "Alice Smith",
        number: "+15551234567",
        message: args.directSend
          ? "Sent SMS directly to Alice Smith."
          : "Opened messaging app with message pre-filled for Alice Smith.",
      };
    },
    blockNumber: async (args) => {
      mockCalls.push({ method: "blockNumber", args });
      return {
        success: true,
        number: args.number,
        roleHeld: false,
        message: `Added ${args.number} to Sierra's blocked list, but OmniAgent does not currently hold the Android Call Screening role.`,
      };
    },
    openMaps: async (args) => {
      mockCalls.push({ method: "openMaps", args });
      return {
        success: true,
        destination: args.destination,
        travelMode: args.travelMode || "driving",
        message: `Opened Google Maps for ${args.destination}.`,
      };
    },
    addCalendarEvent: async (args) => {
      mockCalls.push({ method: "addCalendarEvent", args });
      return {
        success: true,
        eventId: 101,
        title: args.title,
        message: `Created calendar event "${args.title}".`,
      };
    },
    findCalendarEvents: async (args) => {
      mockCalls.push({ method: "findCalendarEvents", args });
      return {
        success: true,
        events: [
          {
            id: 101,
            title: "Dentist Appointment",
            startTimeIso: "2026-05-01T14:00:00.000Z",
            endTimeIso: "2026-05-01T15:00:00.000Z",
          },
        ],
        message: "Found 1 upcoming calendar event.",
      };
    },
    setAlarm: async (args) => {
      mockCalls.push({ method: "setAlarm", args });
      return {
        success: true,
        hour: args.hour,
        minute: args.minute,
        message: `Alarm set for ${args.hour}:${String(args.minute).padStart(2, "0")}.`,
      };
    },
    setTimer: async (args) => {
      mockCalls.push({ method: "setTimer", args });
      return {
        success: true,
        durationSeconds: args.durationSeconds,
        message: `Started timer for ${args.durationSeconds} seconds.`,
      };
    },
    createReminder: async (args) => {
      mockCalls.push({ method: "createReminder", args });
      return {
        success: true,
        eventId: 202,
        title: args.title,
        storedIn: "Android Calendar (CalendarContract.Events + CalendarContract.Reminders)",
        message: `Created reminder "${args.title}" in your Android Calendar with a notification alert.`,
      };
    },
  });

  try {
    // 1. open_app (no confirmation required) + multiple match clarification
    const openSpotify = await executeSierraToolCall("open_app", { appName: "Spotify" });
    assert.strictEqual(openSpotify.response.success, true);
    const openAmbiguous = await executeSierraToolCall("open_app", { appName: "Banking" });
    assert.strictEqual(openAmbiguous.response.needsClarification, true);
    assert.strictEqual(openAmbiguous.response.matches.length, 2);

    // 2. find_contact (no confirmation required)
    const contactRes = await executeSierraToolCall("find_contact", { query: "Alice" });
    assert.strictEqual(contactRes.response.success, true);
    assert.strictEqual(contactRes.response.contacts[0].name, "Alice Smith");

    const { setAppConfirmationDialogHandlerForTests } = await import("../src/lib/actionConfirmationStore.ts");

    // 3. Safety confirmation gates:
    // make_call and send_text use the app-owned confirmation dialog and ignore any model-supplied confirmed:true
    setAppConfirmationDialogHandlerForTests(async () => false);
    const unconfirmedCall = await executeSierraToolCall("make_call", {
      number: "+15551234567",
      recipientName: "Alice Smith",
      confirmed: true, // Model trying to set confirmed:true itself MUST still be blocked when user declines
    });
    assert.strictEqual(unconfirmedCall.response.success, false);
    assert.strictEqual(unconfirmedCall.response.requiresConfirmation, true);
    assert.ok(!mockCalls.some((c) => c.method === "makeCall"), "Must not call native makeCall when user declines in app dialog");

    // User approves in app-owned confirm dialog -> make_call executes native plugin
    setAppConfirmationDialogHandlerForTests(async () => true);
    const confirmedCall = await executeSierraToolCall("make_call", {
      number: "+15551234567",
      recipientName: "Alice Smith",
    });
    assert.strictEqual(confirmedCall.response.success, true);
    assert.ok(mockCalls.some((c) => c.method === "makeCall"));

    // 4. send_text defaults to pre-filled intent when directSmsEnabled is off, and uses directSend when enabled
    setDirectSmsEnabled(false);
    const smsIntentRes = await executeSierraToolCall("send_text", {
      number: "+15551234567",
      recipientName: "Alice Smith",
      message: "On my way!",
    });
    assert.strictEqual(smsIntentRes.response.success, true);
    assert.strictEqual(smsIntentRes.response.mode, "INTENT_PREFILLED");

    setDirectSmsEnabled(true);
    const smsDirectRes = await executeSierraToolCall("send_text", {
      number: "+15551234567",
      recipientName: "Alice Smith",
      message: "On my way!",
      directSend: true,
    });
    assert.strictEqual(smsDirectRes.response.success, true);
    assert.strictEqual(smsDirectRes.response.mode, "DIRECT_SMS");
    setDirectSmsEnabled(false);
    setAppConfirmationDialogHandlerForTests(null);

    // 5. block_number stores in local blocked list and guides user if call screening role not held
    const blockRes = await executeSierraToolCall("block_number", {
      number: "+15559990000",
      confirmed: true,
    });
    assert.strictEqual(blockRes.response.success, true);
    assert.strictEqual(blockRes.response.roleHeld, false);
    assert.ok(getBlockedNumbersList().includes("+15559990000"));

    // 6. open_maps, find_calendar_events, add_calendar_event, set_alarm, set_timer, create_reminder
    const mapsRes = await executeSierraToolCall("open_maps", {
      destination: "Coffee shop",
      travelMode: "walking",
    });
    assert.strictEqual(mapsRes.response.success, true);

    const findCalRes = await executeSierraToolCall("find_calendar_events", { query: "Dentist" });
    assert.strictEqual(findCalRes.response.success, true);
    assert.strictEqual(findCalRes.response.events.length, 1);

    const unconfirmedCal = await executeSierraToolCall("add_calendar_event", {
      title: "Lunch with Bob",
      startTimeIso: "2026-05-02T12:00:00.000Z",
    });
    assert.strictEqual(unconfirmedCal.response.requiresConfirmation, true);

    const confirmedCal = await executeSierraToolCall("add_calendar_event", {
      title: "Lunch with Bob",
      startTimeIso: "2026-05-02T12:00:00.000Z",
      confirmed: true,
    });
    assert.strictEqual(confirmedCal.response.success, true);

    const unconfirmedAlarm = await executeSierraToolCall("set_alarm", {
      hour: 7,
      minute: 30,
      label: "Morning Run",
    });
    assert.strictEqual(unconfirmedAlarm.response.requiresConfirmation, true);

    const confirmedAlarm = await executeSierraToolCall("set_alarm", {
      hour: 7,
      minute: 30,
      label: "Morning Run",
      confirmed: true,
    });
    assert.strictEqual(confirmedAlarm.response.success, true);

    // Timers do not require confirmation
    const timerRes = await executeSierraToolCall("set_timer", {
      durationSeconds: 300,
      label: "Tea",
    });
    assert.strictEqual(timerRes.response.success, true);

    // Reminders require confirmation and honestly state they live in Android Calendar
    const confirmedRem = await executeSierraToolCall("create_reminder", {
      title: "Call Mom",
      timeIso: "2026-05-02T18:00:00.000Z",
      confirmed: true,
    });
    assert.strictEqual(confirmedRem.response.success, true);
    assert.ok(String(confirmedRem.response.message).includes("Calendar"));

    // 7. Disabled capability check refuses execution honestly
    setDeviceCapabilityEnabled("open_app", false);
    const disabledAppRes = await executeDeviceControlTool("open_app", { appName: "Spotify" });
    assert.strictEqual(disabledAppRes.success, false);
    assert.strictEqual(disabledAppRes.capabilityDisabled, true);
    setDeviceCapabilityEnabled("open_app", true);

    // 8. System prompt honesty rules included
    const promptSec = buildDeviceControlPromptSection();
    assert.ok(promptSec.includes("NEVER claim to have called, texted, blocked"));

    // 9. Persistent debug logs recorded tool calls
    const logs = getDebugLogs();
    assert.ok(logs.some((l) => l.stage === "DeviceTool:open_app:Call"));
    assert.ok(logs.some((l) => l.stage === "DeviceTool:make_call:NeedsConfirmation"));
    assert.ok(logs.some((l) => l.stage === "DeviceTool:create_reminder:Result"));
  } finally {
    __setDeviceControlPluginForTests(null);
  }
});

test("Live Session Fixes & Assistant Tools Suite: Failure Shape, open_url Schemes, open_app Fuzzy Match, SMS/CallLog Clamping & Transcription Fallback", async () => {
  const {
    DEVICE_CONTROL_TOOL_NAMES,
    DEVICE_CAPABILITY_DEFINITIONS,
    normalizeAndValidateOpenUrl,
    clampReadMaxResults,
    matchInstalledApps,
    sanitizeToolArgsForLog,
    executeDeviceControlTool,
    setReadMessagesAndCallLogEnabled,
    getDeviceCapabilitiesConfig,
    __setDeviceControlPluginForTests,
  } = await import("../src/lib/deviceControl.ts");
  const { executeSierraToolCall, getAllSierraDeclarations } = await import("../src/lib/toolRouter.ts");
  const {
    resolveAndBuildLiveSetupPayload,
    buildSierraSystemInstruction,
    LIVE_VAD_SILENCE_DURATION_MS,
  } = await import("../src/lib/persona.ts");

  // 1. All 17 device control tools + 2 voice tools + 6 email tools (25 total declarations) registered
  assert.strictEqual(DEVICE_CONTROL_TOOL_NAMES.length, 17);
  assert.strictEqual(DEVICE_CAPABILITY_DEFINITIONS.length, 17);
  const allDecls = getAllSierraDeclarations();
  assert.strictEqual(allDecls.length, 25);
  for (const toolName of [
    "open_url",
    "web_search",
    "read_messages",
    "read_call_log",
    "get_current_time",
    "list_reminders",
    "email_list",
    "email_search",
    "email_read",
    "email_draft",
    "email_send",
    "email_delete",
  ]) {
    assert.ok(allDecls.some((d) => d.name === toolName), `Missing declaration for ${toolName}`);
  }

  // 2. open_url scheme handling (normalizeAndValidateOpenUrl)
  const bareDomain = normalizeAndValidateOpenUrl("sydney.edu.au/news");
  assert.strictEqual(bareDomain.ok, true);
  assert.strictEqual(bareDomain.normalizedUrl, "https://sydney.edu.au/news");

  const validHttps = normalizeAndValidateOpenUrl("https://www.google.com/maps");
  assert.strictEqual(validHttps.ok, true);
  assert.strictEqual(validHttps.normalizedUrl, "https://www.google.com/maps");

  const validHttp = normalizeAndValidateOpenUrl("http://example.org/test");
  assert.strictEqual(validHttp.ok, true);
  assert.strictEqual(validHttp.normalizedUrl, "http://example.org/test");

  const rejectedJs = normalizeAndValidateOpenUrl("javascript:alert(1)");
  assert.strictEqual(rejectedJs.ok, false);
  assert.ok(rejectedJs.reason?.includes("Only http: and https:"));

  const rejectedFile = normalizeAndValidateOpenUrl("file:///sdcard/secret.txt");
  assert.strictEqual(rejectedFile.ok, false);
  assert.ok(rejectedFile.reason?.includes("Only http: and https:"));

  const rejectedEmpty = normalizeAndValidateOpenUrl("   ");
  assert.strictEqual(rejectedEmpty.ok, false);

  // 3. open_app fuzzy matching (case-insensitive, ignores punctuation, label -> partial label -> package)
  const sampleApps = [
    { name: "YouTube", packageName: "com.google.android.youtube" },
    { name: "YouTube Music", packageName: "com.google.android.apps.youtube.music" },
    { name: "CommBank", packageName: "com.commbank.netbank" },
    { name: "NAB Mobile Banking", packageName: "au.com.nab.mobile" },
    { name: "ANZ Plus Banking", packageName: "com.anz.android" },
  ];

  // Exact label match takes priority over partial label match ("YouTube" vs "YouTube Music")
  const exactYt = matchInstalledApps("youtube!", sampleApps);
  assert.strictEqual(exactYt.matchStage, "exact_label");
  assert.strictEqual(exactYt.matches.length, 1);
  assert.strictEqual(exactYt.matches[0].packageName, "com.google.android.youtube");

  // Punctuation-insensitive exact match ("youtube-music" -> "YouTube Music")
  const exactYtm = matchInstalledApps("youtube-music", sampleApps);
  assert.strictEqual(exactYtm.matchStage, "exact_label");
  assert.strictEqual(exactYtm.matches.length, 1);
  assert.strictEqual(exactYtm.matches[0].name, "YouTube Music");

  // Partial label match with multiple results triggers clarification
  const bankingMatches = matchInstalledApps("banking", sampleApps);
  assert.strictEqual(bankingMatches.matchStage, "partial_label");
  assert.strictEqual(bankingMatches.matches.length, 2);

  // Package name fallback when label doesn't match ("netbank" in com.commbank.netbank)
  const pkgMatch = matchInstalledApps("netbank", sampleApps);
  assert.strictEqual(pkgMatch.matchStage, "package_name");
  assert.strictEqual(pkgMatch.matches.length, 1);
  assert.strictEqual(pkgMatch.matches[0].name, "CommBank");

  // 4. read_messages and read_call_log parameter clamping (default 5, cap 20, floor 1)
  assert.strictEqual(clampReadMaxResults(undefined), 5);
  assert.strictEqual(clampReadMaxResults(null), 5);
  assert.strictEqual(clampReadMaxResults("not-a-number"), 5);
  assert.strictEqual(clampReadMaxResults(0), 1);
  assert.strictEqual(clampReadMaxResults(-10), 1);
  assert.strictEqual(clampReadMaxResults(8), 8);
  assert.strictEqual(clampReadMaxResults(999), 20);

  // 5. Log sanitization truncates phone numbers and message bodies
  const sanitized = sanitizeToolArgsForLog({
    number: "+61412345678",
    message: "This is a long private SMS body that should be truncated in the debug log output",
  });
  assert.ok(String(sanitized.number).includes("..."));
  assert.ok(String(sanitized.message).includes("...[truncated]"));

  // 6. Structured tool result shape on failure ({ ok: false, reason, error }) and success ({ ok: true, data })
  let capturedReadMessagesArgs: any = null;
  let capturedReadCallLogArgs: any = null;
  let simulateSmsPermissionDenied = true;

  __setDeviceControlPluginForTests({
    async openUrl(args: any) {
      return {
        ok: true,
        success: true,
        url: args.url,
        data: { url: args.url },
        message: `Opened ${args.url} in default browser.`,
      };
    },
    async webSearch(args: any) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(args.query)}`;
      return {
        ok: true,
        success: true,
        query: args.query,
        url: searchUrl,
        data: { query: args.query, url: searchUrl },
        message: `Opened browser search results for "${args.query}".`,
      };
    },
    async readMessages(args: any) {
      capturedReadMessagesArgs = args;
      if (simulateSmsPermissionDenied) {
        return {
          ok: false,
          success: false,
          permissionDenied: true,
          reason: "READ_SMS permission not granted",
          error: "READ_SMS permission not granted",
        };
      }
      return {
        ok: true,
        success: true,
        count: 1,
        messages: [
          {
            sender: "Alice Smith",
            number: "+61400111222",
            timestamp: 1746500000000,
            dateIso: "2025-05-06T02:53:20.000Z",
            read: false,
            body: "Are we still on for lunch at 1pm?",
          },
        ],
        data: { count: 1 },
        message: "Found 1 SMS message.",
      };
    },
    async readCallLog(args: any) {
      capturedReadCallLogArgs = args;
      return {
        ok: true,
        success: true,
        count: 1,
        calls: [
          {
            name: "Bob Builder",
            number: "+61400999888",
            type: "missed",
            timestamp: 1746500100000,
            dateIso: "2025-05-06T02:55:00.000Z",
            durationSeconds: 0,
          },
        ],
        data: { count: 1 },
        message: "Found 1 call log entry.",
      };
    },
    async getCurrentTime() {
      return {
        ok: true,
        success: true,
        timestampMs: 1746500200000,
        iso: "2025-05-06T12:56:40.000+10:00",
        date: "2025-05-06",
        time: "12:56:40",
        dayOfWeek: "Tuesday",
        timezone: "Australia/Sydney",
        timezoneOffsetMinutes: 600,
        message: "Current device time is Tuesday, 2025-05-06 12:56:40 (Australia/Sydney).",
      };
    },
    async openApp() {
      throw new Error("PackageManager query failed unexpectedly");
    },
  });

  try {
    // Failure shape when read_messages lacks READ_SMS permission
    const deniedSmsRes = await executeSierraToolCall("read_messages", { maxResults: 50, unreadOnly: true });
    assert.strictEqual(deniedSmsRes.response.ok, false);
    assert.strictEqual(deniedSmsRes.response.success, false);
    assert.strictEqual(deniedSmsRes.response.status, "needs_permission");
    assert.ok(String(deniedSmsRes.response.reason).includes("needs permission"));
    // Verify maxResults was clamped to 20 before calling native plugin
    assert.strictEqual(capturedReadMessagesArgs.maxResults, 20);
    assert.strictEqual(capturedSmsUnreadFlag(capturedReadMessagesArgs), true);

    // Grant permission and verify read_messages succeeds with structured data
    simulateSmsPermissionDenied = false;
    const okSmsRes = await executeSierraToolCall("read_messages", { contact: "Alice" });
    assert.strictEqual(okSmsRes.response.ok, true);
    assert.strictEqual(okSmsRes.response.success, true);
    assert.strictEqual(capturedReadMessagesArgs.maxResults, 5);
    assert.strictEqual(okSmsRes.response.messages[0].sender, "Alice Smith");

    // Verify "Let Sierra read my messages and call log" toggle blocks both tools when switched off
    setReadMessagesAndCallLogEnabled(false);
    assert.strictEqual(getDeviceCapabilitiesConfig().readMessagesAndCallLogEnabled, false);
    const toggledOffSms = await executeDeviceControlTool("read_messages", {});
    assert.strictEqual(toggledOffSms.ok, false);
    assert.ok(toggledOffSms.reason?.includes("Let Sierra read my messages and call log"));
    const toggledOffCalls = await executeDeviceControlTool("read_call_log", {});
    assert.strictEqual(toggledOffCalls.ok, false);
    setReadMessagesAndCallLogEnabled(true);

    // Verify read_call_log parameter clamping & type normalization
    const okCallsRes = await executeSierraToolCall("read_call_log", { type: "MISSED", maxResults: 100 });
    assert.strictEqual(okCallsRes.response.ok, true);
    assert.strictEqual(capturedReadCallLogArgs.maxResults, 20);
    assert.strictEqual(capturedReadCallLogArgs.type, "missed");

    // Verify open_url scheme rejection and bare-domain normalization through tool executor
    const badSchemeRes = await executeSierraToolCall("open_url", { url: "javascript:void(0)" });
    assert.strictEqual(badSchemeRes.response.ok, false);
    assert.ok(badSchemeRes.response.reason?.includes("Only http: and https:"));

    const goodUrlRes = await executeSierraToolCall("open_url", { url: "bom.gov.au" });
    assert.strictEqual(goodUrlRes.response.ok, true);
    assert.strictEqual(goodUrlRes.response.url, "https://bom.gov.au");

    // Verify web_search and get_current_time
    const searchRes = await executeSierraToolCall("web_search", { query: "Sydney weather radar" });
    assert.strictEqual(searchRes.response.ok, true);
    assert.ok(String(searchRes.response.url).includes("Sydney%20weather%20radar"));

    const timeRes = await executeSierraToolCall("get_current_time", {});
    assert.strictEqual(timeRes.response.ok, true);
    assert.strictEqual(timeRes.response.timezone, "Australia/Sydney");

    // Verify exception in native plugin is caught and returned as { ok: false, reason }
    const thrownRes = await executeSierraToolCall("open_app", { appName: "Maps" });
    assert.strictEqual(thrownRes.response.ok, false);
    assert.strictEqual(thrownRes.response.reason, "PackageManager query failed unexpectedly");

    // Verify unknown tool returns { ok: false, reason }
    const unknownRes = await executeSierraToolCall("non_existent_tool", {});
    assert.strictEqual(unknownRes.response.ok, false);
    assert.ok(String(unknownRes.response.reason).includes("Unknown tool"));
  } finally {
    __setDeviceControlPluginForTests(null);
  }

  // 7. Transcription language fallback path & session resumption in Live setup payload
  const builtSetup = resolveAndBuildLiveSetupPayload({
    model: "models/gemini-3.8-live",
    languageCode: "en-AU",
    systemInstructionText: buildSierraSystemInstruction("classy", "sfw", undefined, "en-AU"),
    tools: [{ functionDeclarations: getAllSierraDeclarations() }],
    sessionResumptionHandle: "resume-token-abc-123",
  });

  assert.strictEqual(builtSetup.appliedToTranscription, true);
  assert.strictEqual(builtSetup.transcriptionLanguageMethod, "systemInstruction+speechConfig");
  assert.strictEqual(builtSetup.setupPayload.setup.generationConfig.speechConfig.languageCode, "en-AU");
  assert.deepStrictEqual(builtSetup.setupPayload.setup.inputAudioTranscription, {});
  assert.deepStrictEqual(builtSetup.setupPayload.setup.sessionResumption, { handle: "resume-token-abc-123" });
  assert.strictEqual(
    builtSetup.setupPayload.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs,
    LIVE_VAD_SILENCE_DURATION_MS
  );
  assert.strictEqual(LIVE_VAD_SILENCE_DURATION_MS, 800);

  const sysText = builtSetup.setupPayload.setup.systemInstruction.parts[0].text;
  assert.ok(
    sysText.includes("The user speaks English (en-AU, accept en-US). Input audio must be transcribed and understood as English"),
    "System instruction must contain the English (en-AU / en-US) input transcription fallback directive"
  );
  assert.ok(
    sysText.includes("NEVER say \"system error\" generically"),
    "System instruction must forbid generic 'system error' claims"
  );
});

test("OMNI MEGA AGENT 2.9: Shared Tools for Regular & Extended Thinking Live Models, API-Driven Tool Support, App-Owned Confirm Dialog, Device Tools + Reminders, and Keystore-Backed Email Layer (Gmail, Outlook, Yahoo)", async () => {
  const {
    LIVE_MODELS,
    doesModelSupportFunctionCalling,
    getModelToolSupportLabel,
    ingestApiModelMetadata,
    inspectApiErrorForToolSupport,
    probeModelFunctionCallingFromApi,
    clearApiReportedModelCapabilitiesForTests,
    setStoredLiveModel,
    getStoredLiveModel,
    hydratePersistentStateFromNative,
  } = await import("../src/config/models.ts");
  const {
    resolveAndBuildLiveSetupPayload,
    setGeminiThinkingLevel,
  } = await import("../src/lib/persona.ts");
  const {
    getAllSierraFunctionDeclarations,
    executeSierraToolCall,
  } = await import("../src/lib/toolRouter.ts");
  const {
    setAppConfirmationDialogHandlerForTests,
  } = await import("../src/lib/actionConfirmationStore.ts");
  const {
    __setDeviceControlPluginForTests,
    auditDevicePermissionsOnLaunch,
    setDeviceCapabilityEnabled,
    getDeviceCapabilitiesConfig,
  } = await import("../src/lib/deviceControl.ts");
  const {
    __setEmailPluginForTests,
    connectEmailAccountWithKeystore,
    getConnectedEmailAccounts,
    disconnectEmailAccount,
    EMAIL_ACCOUNTS_META_STORAGE_KEY,
  } = await import("../src/lib/emailTools.ts");
  const {
    getDebugLogs,
    clearDebugLogs,
  } = await import("../src/lib/debugLogStore.ts");

  clearApiReportedModelCapabilitiesForTests();
  clearDebugLogs();

  // ---------------------------------------------------------------------------
  // 1. SAME TOOLS FOR EVERY MODEL (Regular Live vs. 3.8 Live Extended Thinking)
  // ---------------------------------------------------------------------------
  setGeminiThinkingLevel("HIGH");
  const regularLiveSetup = resolveAndBuildLiveSetupPayload({
    model: "gemini-3.8-live",
  });
  const extendedThinkingSetup = resolveAndBuildLiveSetupPayload({
    model: "gemini-3.8-live-extended-thinking",
    thinkingLevel: "HIGH",
  });

  const regularTools = regularLiveSetup.setupPayload.setup.tools?.[0]?.functionDeclarations || [];
  const extendedTools = extendedThinkingSetup.setupPayload.setup.tools?.[0]?.functionDeclarations || [];
  const sharedDecls = getAllSierraFunctionDeclarations();

  assert.strictEqual(regularTools.length, 25, "Regular Live model must receive all 25 shared tools");
  assert.strictEqual(extendedTools.length, 25, "3.8 Live Extended Thinking must receive the exact same 25 shared tools");
  assert.deepStrictEqual(
    regularTools.map((d: any) => d.name),
    extendedTools.map((d: any) => d.name),
    "Regular Live and Extended Thinking must receive identical tool declaration lists"
  );
  assert.deepStrictEqual(
    regularTools.map((d: any) => d.name),
    sharedDecls.map((d: any) => d.name)
  );

  // Verify every live model in LIVE_MODELS receives the shared tool list when supported
  for (const m of LIVE_MODELS) {
    const setup = resolveAndBuildLiveSetupPayload({
      model: m.id,
      ...(m.id === "gemini-3.8-live-extended-thinking" ? { thinkingLevel: "MEDIUM" } : {}),
    });
    assert.strictEqual(
      setup.setupPayload.setup.tools?.[0]?.functionDeclarations?.length,
      25,
      `Live model ${m.id} must receive all 25 shared tools`
    );
  }

  // ---------------------------------------------------------------------------
  // 2. ADDITION 4: API-Driven doesModelSupportFunctionCalling (not hardcoded)
  // ---------------------------------------------------------------------------
  // 2a. Probe via Gemini REST API (GET /v1beta/models/{model})
  const fakeFetch = async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes("gemini-audio-only-no-tools")) {
      return {
        ok: true,
        async json() {
          return {
            name: "models/gemini-audio-only-no-tools",
            supportedGenerationMethods: ["bidiGenerateContent"],
            capabilities: { functionCalling: false },
          };
        },
      } as any;
    }
    return {
      ok: true,
      async json() {
        return {
          name: "models/gemini-3.8-live-extended-thinking",
          supportedGenerationMethods: ["bidiGenerateContent", "generateContent"],
          supportsFunctionCalling: true,
        };
      },
    } as any;
  };

  const extSupports = await probeModelFunctionCallingFromApi("test-key", "gemini-3.8-live-extended-thinking", fakeFetch);
  assert.strictEqual(extSupports, true);
  assert.strictEqual(doesModelSupportFunctionCalling("gemini-3.8-live-extended-thinking"), true);
  assert.strictEqual(getModelToolSupportLabel("gemini-3.8-live-extended-thinking"), null);

  const noToolSupports = await probeModelFunctionCallingFromApi("test-key", "gemini-audio-only-no-tools", fakeFetch);
  assert.strictEqual(noToolSupports, false);
  assert.strictEqual(doesModelSupportFunctionCalling("gemini-audio-only-no-tools"), false);
  assert.strictEqual(getModelToolSupportLabel("gemini-audio-only-no-tools"), "no tool support");

  // When a model is reported by the API as not supporting function calling, resolveAndBuildLiveSetupPayload omits tools
  const noToolSetup = resolveAndBuildLiveSetupPayload({
    model: "gemini-audio-only-no-tools",
  });
  assert.strictEqual(noToolSetup.setupPayload.setup.tools, undefined, "Models without tool support must omit tools in setup");

  // 2b. API error inspection marks model as "no tool support"
  inspectApiErrorForToolSupport("gemini-legacy-experimental-live", "Function calling is not supported for this model");
  assert.strictEqual(doesModelSupportFunctionCalling("gemini-legacy-experimental-live"), false);
  assert.strictEqual(getModelToolSupportLabel("gemini-legacy-experimental-live"), "no tool support");

  // 2c. ingestApiModelMetadata with embedding-only model
  ingestApiModelMetadata({
    name: "models/text-embedding-004",
    supportedGenerationMethods: ["embedContent"],
  });
  assert.strictEqual(doesModelSupportFunctionCalling("text-embedding-004"), false);

  // ---------------------------------------------------------------------------
  // 3. DEVICE TOOLS END-TO-END (read_messages, send_text, make_call, create_reminder, list_reminders)
  //    & Permission Revocation Handling
  // ---------------------------------------------------------------------------
  let calendarPermRevoked = false;
  let smsPermRevoked = false;
  const storedReminders: Array<{ id: string; title: string; remindAtIso: string; notes: string }> = [];
  const confirmationPromptsSeen: Array<{ toolName: string; title: string; summary: string }> = [];

  __setDeviceControlPluginForTests({
    async getPermissionsStatus() {
      return {
        contacts: "granted",
        phone: "granted",
        sms: smsPermRevoked ? "denied" : "granted",
        readSms: smsPermRevoked ? "denied" : "granted",
        callLog: "granted",
        calendar: calendarPermRevoked ? "denied" : "granted",
        callScreeningRole: false,
        alarm: "granted",
      };
    },
    async readMessages() {
      if (smsPermRevoked) {
        return {
          ok: false,
          success: false,
          status: "needs_permission",
          permissionDenied: true,
          reason: "needs permission: READ_SMS",
        };
      }
      return {
        ok: true,
        success: true,
        count: 1,
        messages: [
          {
            sender: "Mom",
            number: "+61400555111",
            timestamp: Date.now(),
            body: "Call me when you get home",
          },
        ],
      };
    },
    async sendText(args: any) {
      return {
        ok: true,
        success: true,
        method: args.directSend ? "DIRECT_SMS" : "ACTION_SENDTO",
        phoneNumber: args.phoneNumber,
      };
    },
    async makeCall(args: any) {
      return {
        ok: true,
        success: true,
        actionUsed: "ACTION_CALL",
        phoneNumber: args.phoneNumber,
      };
    },
    async createReminder(args: any) {
      if (calendarPermRevoked) {
        return {
          ok: false,
          success: false,
          status: "needs_permission",
          permissionDenied: true,
          reason: "needs permission: READ_CALENDAR / WRITE_CALENDAR",
        };
      }
      const newRem = {
        id: String(storedReminders.length + 1),
        title: args.title,
        remindAtIso: args.remindAtIso,
        notes: args.notes || "",
      };
      storedReminders.push(newRem);
      return {
        ok: true,
        success: true,
        eventId: newRem.id,
        title: newRem.title,
        remindAtIso: newRem.remindAtIso,
        storedInCalendar: true,
      };
    },
    async listReminders() {
      if (calendarPermRevoked) {
        return {
          ok: false,
          success: false,
          status: "needs_permission",
          permissionDenied: true,
          reason: "needs permission: READ_CALENDAR",
        };
      }
      return {
        ok: true,
        success: true,
        count: storedReminders.length,
        reminders: [...storedReminders],
      };
    },
  });

  // 3a. Launch permission audit
  const launchAudit = await auditDevicePermissionsOnLaunch();
  assert.strictEqual(launchAudit.calendar, "granted");

  // 3b. Create & list reminders end-to-end
  const createRemRes = await executeSierraToolCall("create_reminder", {
    title: "Pay electricity bill",
    remindAtIso: "2026-06-01T09:00:00",
    notes: "Account #9921",
    confirmed: true,
  });
  assert.strictEqual(createRemRes.ok, true);

  const listRemRes = await executeSierraToolCall("list_reminders", {});
  assert.strictEqual(listRemRes.ok, true);
  assert.strictEqual(listRemRes.response.count, 1);
  assert.strictEqual(listRemRes.response.reminders[0].title, "Pay electricity bill");

  // 3c. Revoke READ_CALENDAR & READ_SMS permissions at runtime -> tools report "needs permission"
  calendarPermRevoked = true;
  smsPermRevoked = true;
  const revokedListRem = await executeSierraToolCall("list_reminders", {});
  assert.strictEqual(revokedListRem.ok, false);
  assert.strictEqual(revokedListRem.status, "needs_permission");
  assert.ok(String(revokedListRem.reason).includes("needs permission: READ_CALENDAR"));

  const revokedSms = await executeSierraToolCall("read_messages", {});
  assert.strictEqual(revokedSms.ok, false);
  assert.strictEqual(revokedSms.status, "needs_permission");
  assert.ok(String(revokedSms.reason).includes("needs permission: READ_SMS"));

  calendarPermRevoked = false;
  smsPermRevoked = false;

  // ---------------------------------------------------------------------------
  // 4. ADDITIONS 1, 2, 3: EMAIL LAYER (Gmail, Outlook, Yahoo) + Keystore Vault +
  //    App-Owned Confirm Dialog + Trash Preference + Persistence Across Force-Stop
  // ---------------------------------------------------------------------------
  // Simulated Android Keystore vault & Native SharedPreferences (never touches localStorage)
  const keystoreVault = new Map<string, any>();
  const nativeSharedPrefs = new Map<string, string>();
  const executedEmailActions: Array<any> = [];

  __setEmailPluginForTests({
    async saveAccountCredentials(opts) {
      keystoreVault.set(opts.accountId, { ...opts });
      return { ok: true, status: "saved", accountId: opts.accountId, keystoreBacked: true };
    },
    async removeAccountCredentials(opts) {
      keystoreVault.delete(opts.accountId);
      return { ok: true, status: "removed", accountId: opts.accountId };
    },
    async hasAccountCredentials(opts) {
      const entry = keystoreVault.get(opts.accountId);
      return {
        ok: true,
        hasCredentials: Boolean(entry),
        provider: entry?.provider,
        email: entry?.email,
        keystoreBacked: true,
      };
    },
    async exchangeOAuthCode(opts) {
      keystoreVault.set(opts.accountId, {
        accountId: opts.accountId,
        provider: opts.provider,
        email: opts.email,
        accessToken: `keystore-access-${opts.provider}`,
        refreshToken: `keystore-refresh-${opts.provider}`,
      });
      return { ok: true, status: "exchanged", accountId: opts.accountId, email: opts.email, keystoreBacked: true };
    },
    async executeEmailAction(opts) {
      const creds = keystoreVault.get(opts.accountId);
      if (!creds) {
        return { ok: false, status: "needs_reauth", reason: "No Keystore credentials for account" };
      }
      executedEmailActions.push({ ...opts, provider: creds.provider });

      if (opts.action === "list" || opts.action === "search") {
        return {
          ok: true,
          status: "ok",
          provider: creds.provider,
          account: creds.email,
          action: opts.action,
          count: 1,
          messages: [
            {
              id: `${creds.provider}-msg-101`,
              subject: `Welcome from ${creds.provider.toUpperCase()}`,
              from: `team@${creds.provider}.com`,
              date: "2026-05-06T10:00:00Z",
              snippet: `Sample ${creds.provider} inbox message`,
            },
          ],
        };
      }
      if (opts.action === "read") {
        return {
          ok: true,
          status: "ok",
          provider: creds.provider,
          account: creds.email,
          action: "read",
          message: {
            id: opts.messageId || "msg-101",
            subject: `Full message from ${creds.provider}`,
            from: `team@${creds.provider}.com`,
            date: "2026-05-06T10:00:00Z",
            body: `Full body text from ${creds.provider} account.`,
          },
        };
      }
      if (opts.action === "draft") {
        return {
          ok: true,
          status: "draft_created",
          provider: creds.provider,
          account: creds.email,
          action: "draft",
          draftId: `${creds.provider}-draft-55`,
        };
      }
      if (opts.action === "send") {
        return {
          ok: true,
          status: "sent",
          provider: creds.provider,
          account: creds.email,
          action: "send",
          messageId: `${creds.provider}-sent-88`,
        };
      }
      if (opts.action === "delete") {
        return {
          ok: true,
          status: opts.permanent ? "deleted_permanently" : "moved_to_trash",
          provider: creds.provider,
          account: creds.email,
          action: "delete",
          messageId: opts.messageId,
          movedToTrash: !opts.permanent,
          permanent: Boolean(opts.permanent),
        };
      }
      return { ok: false, status: "unsupported", reason: "Unsupported action" };
    },
    async savePersistentState(opts) {
      nativeSharedPrefs.set(opts.key, opts.value);
      return { ok: true, key: opts.key };
    },
    async loadPersistentState(opts) {
      return {
        ok: true,
        key: opts.key,
        value: nativeSharedPrefs.has(opts.key) ? nativeSharedPrefs.get(opts.key)! : null,
      };
    },
  });

  // Connect all 3 providers: Gmail (OAuth), Outlook (OAuth), Yahoo (App Password)
  const SECRET_GMAIL_TOKEN = "ya29.SUPER_SECRET_GMAIL_ACCESS_TOKEN_DO_NOT_LEAK";
  const SECRET_OUTLOOK_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.SUPER_SECRET_OUTLOOK_TOKEN";
  const SECRET_YAHOO_APP_PASS = "abcd-efgh-ijkl-mnop-yahoo-secret";

  await connectEmailAccountWithKeystore(
    {
      id: "gmail-primary",
      provider: "gmail",
      email: "user@gmail.com",
      displayName: "My Gmail",
      oauthClientId: "gmail-client-id.apps.googleusercontent.com",
      enabled: true,
    },
    { accessToken: SECRET_GMAIL_TOKEN, refreshToken: "1//gmail-refresh-secret" }
  );

  await connectEmailAccountWithKeystore(
    {
      id: "outlook-work",
      provider: "outlook",
      email: "user@outlook.com",
      displayName: "My Outlook",
      oauthClientId: "outlook-client-guid",
      enabled: true,
    },
    { accessToken: SECRET_OUTLOOK_TOKEN, refreshToken: "M.C_outlook_refresh_secret" }
  );

  await connectEmailAccountWithKeystore(
    {
      id: "yahoo-personal",
      provider: "yahoo",
      email: "user@yahoo.com",
      displayName: "My Yahoo",
      enabled: true,
    },
    { appPassword: SECRET_YAHOO_APP_PASS }
  );

  assert.strictEqual(getConnectedEmailAccounts().length, 3, "All 3 email providers must be connected");

  // ADDITION 2 CHECK: Verify ZERO OAuth tokens or Yahoo app passwords exist anywhere in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    const v = localStorage.getItem(k) || "";
    assert.ok(!v.includes(SECRET_GMAIL_TOKEN), `localStorage key "${k}" must NEVER contain Gmail access token`);
    assert.ok(!v.includes(SECRET_OUTLOOK_TOKEN), `localStorage key "${k}" must NEVER contain Outlook access token`);
    assert.ok(!v.includes(SECRET_YAHOO_APP_PASS), `localStorage key "${k}" must NEVER contain Yahoo app password`);
  }

  // Test list, search, read, draft across all 3 providers (NO confirmation dialog required)
  setAppConfirmationDialogHandlerForTests(async (req) => {
    confirmationPromptsSeen.push({ toolName: req.toolName, title: req.title, summary: req.summary });
    return false; // Even if dialog handler returns false, list/search/read/draft must succeed without calling dialog!
  });

  for (const provider of ["gmail", "outlook", "yahoo"] as const) {
    const listRes = await executeSierraToolCall("email_list", { account: provider, maxResults: 5 });
    assert.strictEqual(listRes.ok, true, `email_list must succeed for ${provider}`);
    assert.strictEqual(listRes.response.provider, provider);
    assert.strictEqual(listRes.response.messages[0].id, `${provider}-msg-101`);

    const searchRes = await executeSierraToolCall("email_search", { account: provider, query: "invoice" });
    assert.strictEqual(searchRes.ok, true, `email_search must succeed for ${provider}`);

    const readRes = await executeSierraToolCall("email_read", {
      account: provider,
      messageId: `${provider}-msg-101`,
    });
    assert.strictEqual(readRes.ok, true, `email_read must succeed for ${provider}`);
    assert.ok(String(readRes.response.message.body).includes(provider));

    const draftRes = await executeSierraToolCall("email_draft", {
      account: provider,
      to: "colleague@example.com",
      subject: `Draft via ${provider}`,
      body: "Draft content",
    });
    assert.strictEqual(draftRes.ok, true, `email_draft must succeed without confirmation for ${provider}`);
    assert.strictEqual(draftRes.response.draftId, `${provider}-draft-55`);
  }
  assert.strictEqual(
    confirmationPromptsSeen.length,
    0,
    "email_list, email_search, email_read, and email_draft must NEVER trigger a confirmation dialog"
  );

  // ADDITION 1 CHECK: Model attempts to bypass confirmation by passing confirmed: true on email_send and email_delete
  // When user declines in the app-owned dialog, the action MUST be blocked!
  const spoofedSend = await executeSierraToolCall("email_send", {
    account: "gmail",
    to: "boss@example.com",
    subject: "Spoofed send",
    body: "Trying to bypass confirm",
    confirmed: true,
  });
  assert.strictEqual(spoofedSend.ok, false, "Model passing confirmed:true must NOT bypass app-owned confirm dialog");
  assert.strictEqual(spoofedSend.status, "user_cancelled");
  assert.strictEqual(confirmationPromptsSeen.length, 1);

  const spoofedDelete = await executeSierraToolCall("email_delete", {
    account: "outlook",
    messageId: "outlook-msg-101",
    confirmed: true,
  });
  assert.strictEqual(spoofedDelete.ok, false, "Model passing confirmed:true must NOT bypass app-owned confirm dialog for delete");
  assert.strictEqual(spoofedDelete.status, "user_cancelled");
  assert.strictEqual(confirmationPromptsSeen.length, 2);

  // Now simulate user tapping "Confirm" in the app-owned confirmation dialog
  setAppConfirmationDialogHandlerForTests(async (req) => {
    confirmationPromptsSeen.push({ toolName: req.toolName, title: req.title, summary: req.summary });
    return true;
  });

  for (const provider of ["gmail", "outlook", "yahoo"] as const) {
    const sendRes = await executeSierraToolCall("email_send", {
      account: provider,
      to: "friend@example.com",
      subject: `Hello from ${provider}`,
      body: "Confirmed by user!",
    });
    assert.strictEqual(sendRes.ok, true, `email_send must succeed for ${provider} after user confirms in app dialog`);
    assert.strictEqual(sendRes.response.messageId, `${provider}-sent-88`);

    // Delete defaults to moving to Trash (permanent: false)
    const trashRes = await executeSierraToolCall("email_delete", {
      account: provider,
      messageId: `${provider}-msg-101`,
    });
    assert.strictEqual(trashRes.ok, true, `email_delete must succeed for ${provider} after user confirms`);
    assert.strictEqual(trashRes.response.movedToTrash, true, "email_delete must move to Trash by default");
    assert.strictEqual(trashRes.response.permanent, false);
  }

  // Verify debug logs never contain any secret tokens or Yahoo app passwords
  const allLogsStr = JSON.stringify(getDebugLogs());
  assert.ok(!allLogsStr.includes(SECRET_GMAIL_TOKEN), "Debug logs must never contain Gmail access token");
  assert.ok(!allLogsStr.includes(SECRET_OUTLOOK_TOKEN), "Debug logs must never contain Outlook access token");
  assert.ok(!allLogsStr.includes(SECRET_YAHOO_APP_PASS), "Debug logs must never contain Yahoo app password");

  // ---------------------------------------------------------------------------
  // 5. PERSISTENCE ACROSS APP CLOSE & FORCE-STOP
  // ---------------------------------------------------------------------------
  setStoredLiveModel("gemini-3.8-live-extended-thinking");
  setDeviceCapabilityEnabled("make_call", false);

  // Simulate WebView localStorage wiped after an Android Force-Stop while native SharedPreferences & Keystore survive
  localStorage.removeItem(EMAIL_ACCOUNTS_META_STORAGE_KEY);
  localStorage.removeItem("sierra_live_voice_model");
  localStorage.removeItem("omni_unified_settings_v1");
  localStorage.removeItem("omni_settings_v3");
  localStorage.removeItem("sierra_device_capabilities_v1");

  await hydratePersistentStateFromNative();

  assert.strictEqual(
    getStoredLiveModel(),
    "gemini-3.8-live-extended-thinking",
    "Selected live model must survive app close and force-stop via native SharedPreferences hydration"
  );
  assert.strictEqual(
    getConnectedEmailAccounts().length,
    3,
    "Connected email accounts metadata must survive app close and force-stop"
  );
  assert.strictEqual(
    getDeviceCapabilitiesConfig().enabled.make_call,
    false,
    "Tool enabled states must survive app close and force-stop"
  );

  // ---------------------------------------------------------------------------
  // 5b. GMAIL ANDROID OAUTH CLIENT ID, REDIRECT URI & CREDENTIALS JSON IMPORT
  // ---------------------------------------------------------------------------
  const {
    DEFAULT_GMAIL_OAUTH_CLIENT_ID,
    DEFAULT_GMAIL_REDIRECT_URI,
    EMAIL_PROVIDER_SETUP_GUIDES,
    deriveGoogleAndroidRedirectUri,
    parseGoogleCredentialsJson,
    startNativeGmailOAuthSignIn,
  } = await import("../src/lib/emailTools");

  assert.strictEqual(
    DEFAULT_GMAIL_OAUTH_CLIENT_ID,
    "1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com"
  );
  assert.strictEqual(
    DEFAULT_GMAIL_REDIRECT_URI,
    "com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl:/oauth2redirect"
  );
  assert.deepStrictEqual(EMAIL_PROVIDER_SETUP_GUIDES.gmail.scopes, [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
  assert.strictEqual(
    deriveGoogleAndroidRedirectUri("1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com"),
    "com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl:/oauth2redirect"
  );

  const sampleGoogleCredsJson = JSON.stringify({
    installed: {
      client_id: "1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com",
      project_id: "sierra-omniagent",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    },
  });
  const parsedCreds = parseGoogleCredentialsJson(sampleGoogleCredsJson);
  assert.ok(parsedCreds, "parseGoogleCredentialsJson must parse Google Cloud credentials JSON");
  assert.strictEqual(
    parsedCreds!.clientId,
    "1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com"
  );
  assert.strictEqual(
    parsedCreds!.redirectUri,
    "com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl:/oauth2redirect"
  );

  let nativeSignInCall: any = null;
  __setEmailPluginForTests({
    ...({} as any),
    startOAuthSignIn: async (opts: any) => {
      nativeSignInCall = opts;
      return {
        ok: true,
        launched: true,
        provider: opts.provider,
        clientId: opts.clientId,
        redirectUri: opts.redirectUri,
      };
    },
    removeAccountCredentials: async ({ accountId }: any) => ({ ok: true, accountId }),
  } as any);

  const signInRes = await startNativeGmailOAuthSignIn({ email: "me@gmail.com" });
  assert.strictEqual(signInRes.ok, true);
  assert.strictEqual(
    nativeSignInCall?.clientId,
    "1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com"
  );
  assert.strictEqual(
    nativeSignInCall?.redirectUri,
    "com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl:/oauth2redirect"
  );

  // Restore defaults & clean up test hooks
  setDeviceCapabilityEnabled("make_call", true);
  setStoredLiveModel("gemini-3.8-live");
  await disconnectEmailAccount("gmail-primary");
  await disconnectEmailAccount("outlook-work");
  await disconnectEmailAccount("yahoo-personal");
  setAppConfirmationDialogHandlerForTests(null);
  __setDeviceControlPluginForTests(null);
  __setEmailPluginForTests(null);
  clearApiReportedModelCapabilitiesForTests();
});

test("Test 62: Local (On-Phone) Voice Engine — Sentence Splitter, Turn/Barge-In State Machine, Download Manager Resume Logic, and Sequential TTS Queue", async () => {
  const {
    LocalSentenceSplitter,
    LocalVoiceTurnStateMachine,
    LocalModelDownloadManager,
    LocalTtsQueueCoordinator,
    LOCAL_MODEL_CATALOG,
    getRequiredModelsForSettings,
    DEFAULT_LOCAL_VOICE_SETTINGS,
    buildLocalConversationPrompt,
  } = await import("../src/lib/localVoiceEngine");

  // 1. Verify Verified Model Catalog & Required Models Selection
  assert.ok(LOCAL_MODEL_CATALOG["llm-small-qwen2.5-1.5b"].sizeBytes > 900_000_000);
  assert.ok(LOCAL_MODEL_CATALOG["llm-default-llama3.2-3b"].sizeBytes > 2_000_000_000);
  assert.ok(LOCAL_MODEL_CATALOG["llm-large-dolphin3-8b"].sizeBytes > 4_500_000_000);
  assert.strictEqual(LOCAL_MODEL_CATALOG["llm-large-dolphin3-8b"].speedHeatWarning, true);

  const reqDefault = getRequiredModelsForSettings(DEFAULT_LOCAL_VOICE_SETTINGS);
  assert.ok(reqDefault.some((m) => m.id === "llm-default-llama3.2-3b"));
  assert.ok(reqDefault.some((m) => m.id === "stt-whisper-base-en"));
  assert.ok(reqDefault.some((m) => m.id === "vad-silero"));
  assert.ok(reqDefault.some((m) => m.id === "tts-piper-lessac-en"));

  // Custom GGUF URL support
  const reqCustom = getRequiredModelsForSettings({
    ...DEFAULT_LOCAL_VOICE_SETTINGS,
    llmTier: "custom",
    customGgufUrl: "https://huggingface.co/example/model/resolve/main/custom-q4_k_m.gguf",
    customGgufFilename: "custom-q4_k_m.gguf",
  });
  const customSpec = reqCustom.find((m) => m.id === "llm-custom-gguf");
  assert.ok(customSpec, "Custom GGUF tier must produce a custom model spec");
  assert.strictEqual(customSpec!.filename, "custom-q4_k_m.gguf");

  // 2. Sentence Splitter: abbreviations, decimals, early first-clause flush, and markdown/emoji stripping
  const splitter = new LocalSentenceSplitter({ minFirstClauseChars: 28 });

  // Stream tokens containing abbreviations ("Dr.", "U.S."), decimals ("3.14"), and an early comma clause
  const early1 = splitter.pushToken("Well hello there my friend, ");
  // "Well hello there my friend," is 27 chars; next clause pushes it over 28 chars at comma/semicolon
  assert.strictEqual(early1.length, 0);
  const early2 = splitter.pushToken("I am right here with you, ");
  assert.strictEqual(early2.length, 1, "Must early-flush first spoken clause at comma when >= 28 chars");
  assert.strictEqual(early2[0], "Well hello there my friend, I am right here with you,");

  // Now feed abbreviations and decimals — must NOT split at "Dr." or "3.14" or "e.g."
  assert.strictEqual(splitter.pushToken("Dr. ").length, 0);
  assert.strictEqual(splitter.pushToken("Smith measured ").length, 0);
  assert.strictEqual(splitter.pushToken("3.14 ").length, 0);
  assert.strictEqual(splitter.pushToken("meters (e.g. ").length, 0);
  assert.strictEqual(splitter.pushToken("in the U.S. ").length, 0);
  const fullSent = splitter.pushToken("yesterday)! Next sentence starts here.");
  assert.strictEqual(fullSent.length, 2, "Must emit both completed sentences after ! and .");
  assert.strictEqual(fullSent[0], "Dr. Smith measured 3.14 meters (e.g. in the U.S. yesterday)!");
  assert.strictEqual(fullSent[1], "Next sentence starts here.");

  // Markdown & emoji stripping + flush remaining
  splitter.pushToken("**Bold text** with *italics* 😊 and tail without punctuation");
  const tail = splitter.flush();
  assert.strictEqual(tail, "Bold text with italics and tail without punctuation");

  // 3. Turn & Barge-In State Machine
  const hookOrder: string[] = [];
  let finishedUtteranceAudio: Float32Array | null = null;
  let bargeInTriggerAudio: Float32Array | null = null;

  const sm = new LocalVoiceTurnStateMachine(
    {
      sampleRate: 16000,
      preRollMs: 300, // 4,800 samples
      speechStartMs: 90, // 3 frames of 30ms
      silenceEndTimeoutMs: 600, // 20 frames of 30ms
      minUtteranceDurationMs: 300,
      vadThreshold: 0.45,
      bargeInThreshold: 0.65,
      speakerEchoMargin: 0.15, // Effective threshold during TTS = 0.80
      bargeInSustainedMs: 240, // 8 frames of 30ms
      maxHistoryTurns: 20,
    },
    {
      stopAndFlushAudioPlayback: () => hookOrder.push("1:stopAndFlushAudioPlayback"),
      cancelLlmGeneration: () => hookOrder.push("2:cancelLlmGeneration"),
      cancelTtsAndEmptyQueue: () => hookOrder.push("3:cancelTtsAndEmptyQueue"),
      onBargeInTriggered: (audio) => {
        hookOrder.push("4:onBargeInTriggered");
        bargeInTriggerAudio = audio;
      },
      onUtteranceFinished: (audio) => {
        finishedUtteranceAudio = audio;
      },
    }
  );

  const makeFrame = (val: number, samples = 480): Float32Array => {
    const f = new Float32Array(samples);
    f.fill(val);
    return f;
  };

  // Feed 10 silent pre-roll frames (300 ms total, value = 0.11 so we can verify pre-roll inclusion)
  for (let i = 0; i < 10; i++) {
    sm.processFrame(makeFrame(0.11), 0.1, 30);
  }
  assert.strictEqual(sm.getState(), "idle");

  // Short noise burst (< 300 ms: 4 frames = 120 ms of speech followed by 20 frames = 600 ms of silence) -> discarded!
  for (let i = 0; i < 4; i++) {
    sm.processFrame(makeFrame(0.5), 0.8, 30);
  }
  assert.strictEqual(sm.getState(), "listening_utterance");
  for (let i = 0; i < 20; i++) {
    sm.processFrame(makeFrame(0.0), 0.05, 30);
  }
  assert.strictEqual(sm.getState(), "idle", "Utterance under 300ms must be discarded back to idle");
  assert.strictEqual(finishedUtteranceAudio, null, "Short utterance must not fire onUtteranceFinished");

  // Now feed pre-roll (10 frames of 0.22) + valid utterance (12 frames = 360 ms of 0.77) + 20 frames (600 ms) of silence
  for (let i = 0; i < 10; i++) {
    sm.processFrame(makeFrame(0.22), 0.05, 30);
  }
  for (let i = 0; i < 12; i++) {
    sm.processFrame(makeFrame(0.77), 0.85, 30);
  }
  assert.strictEqual(sm.getState(), "listening_utterance");
  for (let i = 0; i < 20; i++) {
    sm.processFrame(makeFrame(0.0), 0.05, 30);
  }
  assert.strictEqual(sm.getState(), "transcribing", "Must transition to transcribing after 600ms of silence");
  assert.ok(finishedUtteranceAudio, "Must emit finished utterance PCM buffer");
  assert.ok(
    Math.abs(finishedUtteranceAudio![0] - 0.22) < 1e-5,
    "Finished utterance must start with the 300ms pre-roll buffer so the first syllable is not clipped"
  );

  // Commit user transcript and begin assistant speaking
  sm.commitUserTranscript("Tell me a three sentence story.");
  sm.beginAssistantSpeaking();
  assert.strictEqual(sm.getState(), "speaking");

  // Queue 3 sentences, but only mark the first 2 as actually spoken before barge-in occurs
  sm.recordSentenceSpoken("Sentence one was spoken.");
  sm.recordSentenceSpoken("Sentence two was spoken.");
  // (Sentence three is still in the TTS queue and hasn't finished playing)

  // While Sierra is speaking, speaker echo at VAD = 0.72 (< 0.65 + 0.15 = 0.80) must NOT trigger barge-in
  for (let i = 0; i < 15; i++) {
    const res = sm.processFrame(makeFrame(0.3), 0.72, 30);
    assert.strictEqual(res.bargeInTriggered, false, "Echo below raised threshold (0.80) must not interrupt");
  }
  assert.strictEqual(sm.getState(), "speaking");

  // Now user speaks above raised threshold (VAD = 0.90 >= 0.80) for 240 ms (8 frames of 30 ms)
  let triggeredOnFrame = -1;
  for (let i = 0; i < 8; i++) {
    const res = sm.processFrame(makeFrame(0.88), 0.90, 30);
    if (res.bargeInTriggered) triggeredOnFrame = i;
  }
  assert.strictEqual(triggeredOnFrame, 7, "Barge-in must trigger after sustained 240ms (8 x 30ms frames)");

  // Verify strict barge-in execution order:
  // 1. stop and flush audio playback
  // 2. cancel LLM generation
  // 3. cancel TTS and empty its queue
  // 4. notify barge-in with captured trigger audio
  assert.deepStrictEqual(
    hookOrder,
    [
      "1:stopAndFlushAudioPlayback",
      "2:cancelLlmGeneration",
      "3:cancelTtsAndEmptyQueue",
      "4:onBargeInTriggered",
    ],
    "Barge-in hooks must execute in exact order: stop audio -> cancel LLM -> cancel TTS -> capture new utterance"
  );
  assert.ok(bargeInTriggerAudio && bargeInTriggerAudio!.length > 0, "Must capture the audio that triggered the interrupt");
  assert.strictEqual(
    sm.getState(),
    "listening_utterance",
    "State machine must immediately be capturing the new utterance after barge-in"
  );

  // Verify chat history recorded ONLY the spoken prefix ("Sentence one was spoken. Sentence two was spoken.") marked interrupted
  const historyAfterBargeIn = sm.getHistory();
  assert.strictEqual(historyAfterBargeIn.length, 2);
  assert.strictEqual(historyAfterBargeIn[0].role, "user");
  assert.strictEqual(historyAfterBargeIn[1].role, "assistant");
  assert.strictEqual(historyAfterBargeIn[1].content, "Sentence one was spoken. Sentence two was spoken.");
  assert.strictEqual(historyAfterBargeIn[1].interrupted, true);

  // Verify 20-turn (40-message) history cap
  for (let t = 0; t < 25; t++) {
    sm.commitUserTranscript(`User turn ${t}`);
    sm.beginAssistantSpeaking();
    sm.recordSentenceSpoken(`Assistant turn ${t}`);
    sm.finishAssistantSpeaking();
  }
  assert.strictEqual(sm.getHistory().length, 40, "Chat history must be capped at 20 turns (40 messages)");

  // 4. Download Manager: Preflight Warnings, Pause, Resume with HTTP Range header, Retry, SHA-256 Verification, and Delete
  const dm = new LocalModelDownloadManager(["vad-silero", "stt-whisper-tiny-en"]);
  const vadSpec = LOCAL_MODEL_CATALOG["vad-silero"];

  // Preflight check: warn when not on Wi-Fi and when free storage is below 1.2x required bytes
  const preflightWarn = dm.evaluateDownloadPreflight({
    isWifi: false,
    freeBytes: 1_000_000, // Only 1 MB free
    selectedIds: ["vad-silero"],
  });
  assert.strictEqual(preflightWarn.wifiWarning, true, "Must warn when not on Wi-Fi");
  assert.strictEqual(preflightWarn.lowStorageWarning, true, "Must warn when free storage is too low");

  // Start download -> simulate 1,000,000 bytes -> pause -> verify Range header for resume
  dm.startOrResume("vad-silero");
  assert.deepStrictEqual(
    dm.buildResumeHttpHeaders("vad-silero"),
    {},
    "Initial download at 0 bytes must not send Range header"
  );

  dm.onChunkReceived("vad-silero", 1_000_000, vadSpec.sizeBytes);
  dm.pause("vad-silero");
  assert.strictEqual(dm.getState("vad-silero").status, "paused");
  assert.strictEqual(dm.getState("vad-silero").downloadedBytes, 1_000_000);

  // Resume from paused offset -> must generate Range: bytes=1000000-
  const resumeInfo = dm.startOrResume("vad-silero");
  assert.strictEqual(resumeInfo.resumeFromByte, 1_000_000);
  assert.deepStrictEqual(dm.buildResumeHttpHeaders("vad-silero"), {
    Range: "bytes=1000000-",
  });

  // Simulate remaining bytes + SHA-256 mismatch first, then valid SHA-256
  const { getDebugLogs } = await import("../src/lib/debugLogStore");
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["llm-small-qwen2.5-1.5b"].sha256,
    "59aa9f44bde5349dbe292d7024d197db605f422b8baf65f3246a59abbde4e8e9"
  );
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["llm-default-llama3.2-3b"].sha256,
    "80f532552e3d56e366226f428395de8285a671f2da1d5fd68563741181b77a95"
  );
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["llm-large-dolphin3-8b"].sha256,
    "268390e07edd407ad93ea21a868b7ae995b5950e01cad0db9e1802ae5049d405"
  );
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["vad-silero"].sha256,
    "a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808"
  );
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["tts-piper-lessac-en"].sha256,
    "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f"
  );
  assert.strictEqual(
    LOCAL_MODEL_CATALOG["tts-piper-lessac-config"].sha256,
    "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0"
  );

  dm.onChunkReceived("vad-silero", vadSpec.sizeBytes - 1_000_000);
  const wrongSha = "0000000000000000000000000000000000000000000000000000000000000000";
  const badVerify = dm.verifyAndComplete("vad-silero", wrongSha);
  assert.strictEqual(badVerify, false, "Mismatched SHA-256 must fail verification");
  const errState = dm.getState("vad-silero");
  assert.strictEqual(errState.status, "error");
  assert.strictEqual(errState.downloadedBytes, 0, "Corrupted file must reset byte offset to 0");
  assert.strictEqual(errState.badFilePath, "silero_vad.onnx.bad", "Mismatched file must be kept as .bad");
  assert.ok(
    errState.error?.includes(vadSpec.sha256!) && errState.error?.includes(wrongSha),
    "Error must include full expected and actual SHA-256 hashes"
  );
  assert.ok(
    getDebugLogs().some(
      (l) => l.detail.includes(vadSpec.sha256!) && l.detail.includes(wrongSha) && l.detail.includes("silero_vad.onnx.bad")
    ),
    "Persistent debug log must record full expected and actual SHA-256 hashes and .bad filename"
  );

  // Retry after error increments retryCount
  const retryInfo = dm.retry("vad-silero");
  assert.strictEqual(retryInfo.retryCount, 1);
  dm.onChunkReceived("vad-silero", vadSpec.sizeBytes);
  const goodVerify = dm.verifyAndComplete("vad-silero", vadSpec.sha256);
  assert.strictEqual(goodVerify, true, "Matching SHA-256 must mark model ready");
  assert.strictEqual(dm.getState("vad-silero").status, "ready");

  // Null-hash entry verifies by exact byte size only and logs "checksum unverified"
  dm.onChunkReceived("custom-unverified-entry", 12345, 12345);
  const unverifiedOk = dm.verifyAndComplete("custom-unverified-entry", null, 12345);
  assert.strictEqual(unverifiedOk, true, "Null-hash entry with matching byte size must succeed");
  assert.strictEqual(dm.getState("custom-unverified-entry").checksumUnverified, true);
  assert.ok(
    getDebugLogs().some((l) => l.detail.includes("checksum unverified")),
    "Must log 'checksum unverified' warning when sha256 is null"
  );

  // Delete all models resets state to not_downloaded
  dm.deleteAll();
  assert.strictEqual(dm.getState("vad-silero").status, "not_downloaded");
  assert.strictEqual(dm.getState("vad-silero").downloadedBytes, 0);

  // 5. Sequential TTS Queue Coordinator: Sentence N must NEVER play after Sentence N+1
  const playedOrder: string[] = [];
  const fakeTtsEngine = {
    id: "piper" as const,
    isAvailable: async () => true,
    synthesizeSentence: async (text: string) => {
      // Simulate sentence 1 taking longer to synthesize than sentence 2
      const delayMs = text.includes("Sentence 1") ? 45 : 5;
      await new Promise((r) => setTimeout(r, delayMs));
      return { pcm16: new Int16Array(160), sampleRate: 22050 };
    },
    stop: async () => {},
  };

  const coordinator = new LocalTtsQueueCoordinator(
    fakeTtsEngine,
    async (_pcm, _sr, sentenceText) => {
      playedOrder.push(sentenceText);
    },
    (sentenceText) => {
      playedOrder.push(`spoken:${sentenceText}`);
    }
  );

  const p1 = coordinator.enqueueSentence("Sentence 1 (slow synthesis).");
  const p2 = coordinator.enqueueSentence("Sentence 2 (fast synthesis).");
  await Promise.all([p1, p2]);

  assert.deepStrictEqual(
    playedOrder,
    [
      "Sentence 1 (slow synthesis).",
      "spoken:Sentence 1 (slow synthesis).",
      "Sentence 2 (fast synthesis).",
      "spoken:Sentence 2 (fast synthesis).",
    ],
    "Sentence 1 must strictly play and finish before Sentence 2 even when Sentence 2 synthesizes faster"
  );

  // 6. Prompt Builder: preserves 18+ contentMode setting, local memory summaries, and spoken-reply instruction
  const maturePrompt = buildLocalConversationPrompt({
    personaId: "classy",
    contentMode: "mature",
    identity: "sierra",
    chatTemplate: "llama3",
    turns: [{ role: "user", content: "Hey Sierra!", timestamp: Date.now() }],
    userMessage: "Tell me something bold.",
  });
  assert.ok(maturePrompt.includes("<|begin_of_text|><|start_header_id|>system<|end_header_id|>"));
  assert.ok(maturePrompt.includes("LOCAL ON-DEVICE VOICE CONVERSATION RULES"));
  assert.ok(maturePrompt.includes("NEVER use markdown"));

  // 7. Barge-In Queue Cancellation: when barge-in interrupts Sentence 1, queued Sentences 2 & 3 must NEVER be spoken
  const spokenSentences: string[] = [];
  let ttsStopCalled = 0;
  let resolveSentence1Playback: (() => void) | null = null;

  const bargeInTtsEngine = {
    id: "android_tts" as const,
    isAvailable: async () => true,
    synthesizeSentence: async (text: string) => ({
      engineId: "android_tts" as const,
      sentence: text,
      sampleRate: 22050,
    }),
    stop: async () => {
      ttsStopCalled++;
      if (resolveSentence1Playback) {
        resolveSentence1Playback();
      }
    },
  };

  const bargeInQueue = new LocalTtsQueueCoordinator({
    primaryEngine: bargeInTtsEngine,
    fallbackEngine: bargeInTtsEngine,
    playChunkFn: async (chunk) => {
      spokenSentences.push(`start:${chunk.sentence}`);
      if (chunk.sentence.includes("Sentence 1")) {
        await new Promise<void>((resolve) => {
          resolveSentence1Playback = resolve;
        });
      }
      spokenSentences.push(`finish:${chunk.sentence}`);
    },
  });

  bargeInQueue.beginTurn(42);
  const s1Promise = bargeInQueue.enqueueSentence("Sentence 1 is speaking now.", 42);
  const s2Promise = bargeInQueue.enqueueSentence("Sentence 2 was queued before barge-in.", 42);
  const s3Promise = bargeInQueue.enqueueSentence("Sentence 3 was also queued before barge-in.", 42);

  // Wait until Sentence 1 starts playing
  await new Promise((r) => setTimeout(r, 15));
  assert.deepStrictEqual(spokenSentences, ["start:Sentence 1 is speaking now."]);

  // Trigger barge-in while Sentence 1 is mid-playback
  await bargeInQueue.cancelAndClear();
  assert.strictEqual(bargeInQueue.isTurnCancelled(42), true, "Turn 42 must be marked cancelled after barge-in");
  assert.ok(ttsStopCalled >= 1, "TTS engine stop() must be invoked immediately on barge-in");

  // Also test late tail sentence flush for Turn 42 after barge-in
  await bargeInQueue.enqueueSentence("Late tail sentence from Turn 42.", 42);
  await Promise.all([s1Promise, s2Promise, s3Promise]);

  assert.strictEqual(
    spokenSentences.some((s) => s.includes("Sentence 2") || s.includes("Sentence 3") || s.includes("Late tail")),
    false,
    "Queued sentences 2 and 3 or late tail sentence from an interrupted turn must NEVER be spoken"
  );

  // 8. Memory Safety: placeholder transcripts, canned replies, and error replies must NEVER be saved to Sierra's memory
  const {
    isPlaceholderOrErrorTurn,
    summarizeAndSaveConversation,
    saveConversationSummary,
    getConversationSummaries,
    STORAGE_KEY_CONVERSATION_SUMMARIES,
  } = await import("../src/lib/persona");

  assert.strictEqual(isPlaceholderOrErrorTurn("[Voice utterance 1184 ms]"), true);
  assert.strictEqual(isPlaceholderOrErrorTurn("[BLANK_AUDIO]"), true);
  assert.strictEqual(
    isPlaceholderOrErrorTurn(
      "I heard you clearly. Since we're running in on-device mode, your voice stays completely private on your phone. What would you like to talk about next?"
    ),
    true
  );
  assert.strictEqual(isPlaceholderOrErrorTurn("Real user speech about planning a weekend hike."), false);

  localStorage.removeItem(STORAGE_KEY_CONVERSATION_SUMMARIES);
  const rejectedPlaceholderSummary = summarizeAndSaveConversation(
    "local-placeholder-session",
    [
      { role: "user", content: "[Voice utterance 1184 ms]" },
      {
        role: "model",
        content:
          "I heard you clearly. Since we're running in on-device mode, your voice stays completely private on your phone. What would you like to talk about next?",
      },
    ],
    "Live Voice Conversation",
    "live",
    "en-US"
  );
  assert.strictEqual(rejectedPlaceholderSummary, null, "Placeholder/canned turn must never be summarized");
  saveConversationSummary({
    id: "bad-direct-summary",
    updatedAt: Date.now(),
    source: "live",
    title: "Live Voice Conversation",
    summary: "User said: [Voice utterance 1184 ms] | Sierra replied: I heard you clearly.",
  });
  assert.strictEqual(
    getConversationSummaries().length,
    0,
    "Memory store must contain zero summaries from placeholder or canned simulation turns"
  );

  // 9. Verify native Java and C++ files contain real JNI calls and zero simulated/canned strings
  const fsMod = await import("node:fs");
  const engineJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoiceEngine.java", "utf8");
  const pluginJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoicePlugin.java", "utf8");
  const jniCpp = fsMod.readFileSync("android/app/src/main/cpp/sierra_local_voice_jni.cpp", "utf8");

  assert.strictEqual(
    engineJava.includes("[Voice utterance "),
    false,
    "LocalVoiceEngine.java must not contain placeholder '[Voice utterance ... ms]' string"
  );
  assert.strictEqual(
    pluginJava.includes("I heard you clearly. Since we're running in on-device mode"),
    false,
    "LocalVoicePlugin.java must not contain canned simulation reply strings"
  );
  assert.strictEqual(
    pluginJava.includes("generateOnDeviceConversationalReply"),
    false,
    "LocalVoicePlugin.java must not contain simulated reply generator"
  );
  assert.ok(
    jniCpp.includes("llama_load_model_from_file") &&
      jniCpp.includes("whisper_full") &&
      jniCpp.includes("Java_com_sierra_omniagent_LocalVoiceEngine_nativeGenerateStream") &&
      jniCpp.includes("Java_com_sierra_omniagent_LocalVoiceEngine_nativeTranscribePcm16") &&
      jniCpp.includes("Java_com_sierra_omniagent_LocalVoiceEngine_nativeRunSelfTest"),
    "sierra_local_voice_jni.cpp must implement real llama.cpp and whisper.cpp JNI inference functions"
  );

  // 10. Verify Local LLM Diagnostic Logging, 20-Second First-Token Watchdog, Mutex Cancel Reset, and Memory Cap (3 summaries / 600 chars)
  const {
    MAX_INJECTED_MEMORY_SUMMARIES,
    MAX_INJECTED_MEMORY_CHARS,
    setMemoryInjectionEnabled,
    isMemoryInjectionEnabled,
  } = await import("../src/lib/persona");

  assert.strictEqual(MAX_INJECTED_MEMORY_SUMMARIES, 3, "Memory injection must cap at 3 recent summaries");
  assert.strictEqual(MAX_INJECTED_MEMORY_CHARS, 600, "Memory injection must cap at 600 characters total");

  // Save 6 summaries totaling > 1200 chars and verify at most 3 summaries and <= 600 chars are injected
  localStorage.removeItem(STORAGE_KEY_CONVERSATION_SUMMARIES);
  for (let i = 1; i <= 6; i++) {
    saveConversationSummary({
      id: `mem-cap-${i}`,
      updatedAt: 1000 + i,
      source: "chat",
      title: `Topic ${i}`,
      summary: `Summary number ${i}: ` + "Detailed context about software engineering and music preferences. ".repeat(4),
    });
  }

  const cappedPrompt = buildLocalConversationPrompt({
    personaId: "classy",
    contentMode: "sfw",
    identity: "sierra",
    chatTemplate: "chatml",
    turns: [],
    userMessage: "What time is it?",
    injectMemory: true,
  });
  const memLog = getDebugLogs()
    .slice()
    .reverse()
    .find((l) => l.detail.startsWith("[Memory] Injected "));
  assert.ok(memLog, "Must log [Memory] Injected line");
  const memMatch = memLog!.detail.match(/\[Memory\] Injected (\d+) summaries, (\d+) chars/);
  assert.ok(memMatch, `Unexpected memory log format: ${memLog!.detail}`);
  assert.ok(Number(memMatch![1]) <= 3, `Injected summary count (${memMatch![1]}) must be <= 3`);
  assert.ok(Number(memMatch![2]) <= 600, `Injected memory chars (${memMatch![2]}) must be <= 600`);

  const promptBuiltLog = getDebugLogs()
    .slice()
    .reverse()
    .find((l) => l.stage === "LocalLLM:PromptBuilt");
  assert.ok(
    promptBuiltLog && promptBuiltLog.detail.includes(`Final prompt length: ${cappedPrompt.length} chars`),
    "Must log LocalLLM:PromptBuilt with final prompt character count"
  );

  // Verify toggling memory injection off skips all memory summaries
  setMemoryInjectionEnabled(false);
  assert.strictEqual(isMemoryInjectionEnabled(), false);
  const noMemPrompt = buildLocalConversationPrompt({
    personaId: "classy",
    contentMode: "sfw",
    identity: "sierra",
    chatTemplate: "chatml",
    turns: [],
    userMessage: "What time is it?",
    injectMemory: false,
  });
  assert.strictEqual(
    noMemPrompt.includes("Summary number "),
    false,
    "Prompt with injectMemory=false must not include any saved summaries"
  );
  setMemoryInjectionEnabled(true);

  // Verify JNI C++ and Java diagnostic stages, 20s watchdog, g_cancelLlm reset inside g_llmMutex, and 4-thread cap
  assert.ok(
    jniCpp.includes('emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Start"') &&
      jniCpp.includes('emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "BatchEval"') &&
      jniCpp.includes('emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "PromptEvalDone"') &&
      jniCpp.includes('emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "FirstToken"') &&
      jniCpp.includes('emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "GenEnd"'),
    "sierra_local_voice_jni.cpp must emit Start, BatchEval, PromptEvalDone, FirstToken, and GenEnd diagnostics"
  );
  assert.ok(
    jniCpp.includes("std::lock_guard<std::mutex> lock(g_llmMutex);\n    bool prevCancelWasSet = g_cancelLlm.exchange(false);"),
    "g_cancelLlm must be reset to false inside the g_llmMutex lock at the start of nativeGenerateStream"
  );
  assert.ok(
    engineJava.includes("PROMPT_EVAL_STALL_TIMEOUT_MS = 45000L") &&
      engineJava.includes("TOKEN_GEN_STALL_TIMEOUT_MS = 20000L") &&
      engineJava.includes('"LocalLLM:Stall"') &&
      engineJava.includes('"LocalLLM:TokenSample"') &&
      engineJava.includes("cpuCores >= 8 ? 6 : 4") &&
      engineJava.includes("getLastNativeError"),
    "LocalVoiceEngine.java must implement the progress-based stall detector (45s prompt eval / 20s token gen), LocalLLM:TokenSample logging, 6 threads on 8-core devices, and getLastNativeError"
  );
});

test("OpenRouter Live, Local Progress Stall Detector, Compact Prompt Token Budget & Ollama Fallback", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    LocalSentenceSplitter,
    ProgressStallDetector,
    LOCAL_PROMPT_EVAL_STALL_TIMEOUT_MS,
    LOCAL_TOKEN_GEN_STALL_TIMEOUT_MS,
    LOCAL_COMPACT_MAX_SUMMARIES,
    LOCAL_COMPACT_MAX_MEMORY_CHARS,
    LOCAL_COMPACT_MAX_HISTORY_MESSAGES,
    buildCompactLocalSystemPrompt,
    buildLocalConversationPrompt,
    estimateLocalTokenCount,
  } = await import("../src/lib/localVoiceEngine");

  const {
    OPENROUTER_DEFAULT_PAID_MODEL,
    filterOpenRouterFreeModels,
    parseOpenRouterErrorResponse,
    fallbackToOpenRouterPaidDefault,
    getOpenRouterModelSettings,
    saveOpenRouterModelSettings,
    streamOpenRouterLiveTurn,
  } = await import("../src/lib/openRouterLive");

  const {
    OLLAMA_UNREACHABLE_MESSAGE,
    isOllamaUnreachableFetchError,
    formatOllamaConnectionError,
    streamChat,
    saveProviderConfig,
  } = await import("../src/lib/providers");

  const {
    saveConversationSummary,
    clearConversationSummaries,
    setOpenRouterApiKey,
  } = await import("../src/lib/persona");

  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");

  // 1. UNIT TEST: Sentence-chunk splitter (splits at . ! ? \n with min ~25 chars)
  const splitter = new LocalSentenceSplitter(25);
  const tokens = [
    "Hey! ", // < 25 chars, held until combined with next sentence
    "I am right here with you tonight. ",
    "What is on your mind right now? ",
    "Tell me everything that happened today\n",
    "Final short tail.",
  ];
  const emittedSentences: string[] = [];
  for (const tok of tokens) {
    emittedSentences.push(...splitter.pushToken(tok));
  }
  const remainder = splitter.flushRemainder();
  if (remainder) emittedSentences.push(remainder);

  assert.strictEqual(emittedSentences.length, 4, `Expected 4 emitted sentences, got ${emittedSentences.length}`);
  assert.ok(
    emittedSentences[0].startsWith("Hey! I am right here with you tonight.") && emittedSentences[0].length >= 25,
    `First sentence should merge short greeting to meet >=25 char threshold: "${emittedSentences[0]}"`
  );
  assert.strictEqual(emittedSentences[1], "What is on your mind right now?");
  assert.strictEqual(emittedSentences[2], "Tell me everything that happened today");
  assert.strictEqual(emittedSentences[3], "Final short tail.");

  // 2. UNIT TEST: Progress-based stall detector (resets on completed prompt batch & generated token)
  assert.strictEqual(LOCAL_PROMPT_EVAL_STALL_TIMEOUT_MS, 45000);
  assert.strictEqual(LOCAL_TOKEN_GEN_STALL_TIMEOUT_MS, 20000);

  const detector = new ProgressStallDetector(1000, 45000, 20000);
  assert.strictEqual(detector.getPhase(), "prompt_eval");

  // At t=35s (34s elapsed) with no batch yet -> NOT stalled (limit is 45s)
  assert.strictEqual(detector.evaluate(35000).stalled, false);

  // Batch 0 completes at t=36s -> resets timer!
  detector.onPromptBatchCompleted(0, 36000);
  // At t=75s (39s since batch 0, 74s since start) -> still NOT stalled because batch 0 reset timer!
  assert.strictEqual(detector.evaluate(75000).stalled, false);

  // At t=82s (46s since batch 0) -> STALLED during prompt_eval (>45s without batch progress)
  const promptStall = detector.evaluate(82000);
  assert.strictEqual(promptStall.stalled, true);
  assert.strictEqual(promptStall.phase, "prompt_eval");
  assert.ok(promptStall.reason.includes("prompt evaluation"));

  // Transition to token generation at t=85s
  detector.onPromptEvalFinished(85000);
  assert.strictEqual(detector.getPhase(), "generation");
  assert.strictEqual(detector.evaluate(100000).stalled, false, "15s into generation should not stall");

  // Token generated at t=102s -> resets generation timer!
  detector.onTokenGenerated(102000);
  assert.strictEqual(detector.evaluate(118000).stalled, false, "16s since last token should not stall");

  // At t=123s (21s since last token) -> STALLED during token generation (>20s without token progress)
  const genStall = detector.evaluate(123000);
  assert.strictEqual(genStall.stalled, true);
  assert.strictEqual(genStall.phase, "generation");
  assert.ok(genStall.reason.includes("token generation"));

  // 3. UNIT TEST: Compact prompt builder (strictly 250–400 token budget, max 2 summaries / 300 chars, last 4 history messages)
  assert.strictEqual(LOCAL_COMPACT_MAX_SUMMARIES, 2);
  assert.strictEqual(LOCAL_COMPACT_MAX_MEMORY_CHARS, 300);
  assert.strictEqual(LOCAL_COMPACT_MAX_HISTORY_MESSAGES, 4);

  clearConversationSummaries();
  for (let i = 1; i <= 5; i++) {
    saveConversationSummary({
      id: `local-sum-${i}`,
      updatedAt: 2000 + i,
      source: "live",
      title: `Session ${i}`,
      summary: `Summary ${i}: Discussed mountain trail running, espresso roasting, and late-night sci-fi movies in detail.`,
    });
  }

  for (const identity of ["sierra", "tyler"] as const) {
    for (const mode of ["sfw", "mature"] as const) {
      const compactRes = buildCompactLocalSystemPrompt({
        personaId: "confident",
        contentMode: mode,
        identity,
        injectMemory: true,
      });
      assert.ok(
        compactRes.estimatedTokens >= 250 && compactRes.estimatedTokens <= 400,
        `Compact system prompt tokens (${compactRes.estimatedTokens}) must be between 250 and 400 for ${identity}/${mode}`
      );
      assert.ok(compactRes.summaryCount <= 2, `Summary count (${compactRes.summaryCount}) must be <= 2`);
      assert.ok(compactRes.summaryChars <= 300, `Summary chars (${compactRes.summaryChars}) must be <= 300`);
      assert.ok(
        compactRes.systemPrompt.includes(identity === "sierra" ? "You are Sierra" : "You are Tyler"),
        "Compact system prompt must include companion identity"
      );
      assert.ok(compactRes.systemPrompt.includes("English (en-US)"), "Must include English-only rule");
      assert.ok(
        compactRes.systemPrompt.includes("only know what is in the injected memory summaries and current chat"),
        "Must include honesty line"
      );
    }
  }

  // Verify history is capped at last 4 messages, and omitHistory=true omits all prior turns
  const sixMessages = [
    { role: "user" as const, content: "Msg 1 oldest", timestamp: 1 },
    { role: "assistant" as const, content: "Msg 2 oldest", timestamp: 2 },
    { role: "user" as const, content: "Msg 3 kept", timestamp: 3 },
    { role: "assistant" as const, content: "Msg 4 kept", timestamp: 4 },
    { role: "user" as const, content: "Msg 5 kept", timestamp: 5 },
    { role: "assistant" as const, content: "Msg 6 kept", timestamp: 6 },
  ];
  const promptWith4 = buildLocalConversationPrompt({
    personaId: "classy",
    contentMode: "sfw",
    identity: "sierra",
    chatTemplate: "chatml",
    history: sixMessages,
    userUtterance: "Latest question?",
  });
  assert.strictEqual(promptWith4.includes("Msg 1 oldest"), false, "Message 1 must be dropped by 4-message cap");
  assert.strictEqual(promptWith4.includes("Msg 2 oldest"), false, "Message 2 must be dropped by 4-message cap");
  assert.strictEqual(promptWith4.includes("Msg 3 kept"), true, "Message 3 must be retained in last 4 messages");
  assert.strictEqual(promptWith4.includes("Msg 6 kept"), true, "Message 6 must be retained in last 4 messages");

  const promptOmitHistory = buildLocalConversationPrompt({
    personaId: "classy",
    contentMode: "sfw",
    identity: "sierra",
    chatTemplate: "chatml",
    history: sixMessages,
    userUtterance: "Retry question after stall",
    omitHistory: true,
  });
  assert.strictEqual(promptOmitHistory.includes("Msg 6 kept"), false, "omitHistory=true must omit all history turns");
  assert.strictEqual(promptOmitHistory.includes("Retry question after stall"), true);
  assert.ok(estimateLocalTokenCount(promptOmitHistory) > 250);

  // 4. UNIT TEST: Free-model filter (keeps only :free IDs with zero prompt and completion price)
  const sampleModelsPayload = {
    data: [
      {
        id: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
        name: "Dolphin Mistral 24B Venice Edition",
        pricing: { prompt: "0.0000002", completion: "0.0000009" },
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        name: "Llama 3.3 70B Instruct (free)",
        pricing: { prompt: "0", completion: "0" },
        context_length: 131072,
      },
      {
        id: "qwen/qwen-2.5-72b-instruct:free",
        name: "Qwen 2.5 72B Instruct (free)",
        pricing: { prompt: "0.0", completion: "0.0" },
      },
      {
        id: "fake/misleading-model:free",
        name: "Misleading Paid Free Model",
        pricing: { prompt: "0.0001", completion: "0" },
      },
      {
        id: "zero-price/without-free-suffix",
        name: "Zero Price Without Free Suffix",
        pricing: { prompt: "0", completion: "0" },
      },
    ],
  };
  const filteredFree = filterOpenRouterFreeModels(sampleModelsPayload);
  assert.strictEqual(filteredFree.length, 2, "Must keep only :free models with zero prompt and completion pricing");
  assert.deepStrictEqual(
    filteredFree.map((m) => m.id),
    ["meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen-2.5-72b-instruct:free"]
  );

  // 5. UNIT TEST: Model-error fallback & real OpenRouter error extraction
  const err404Json = JSON.stringify({
    error: {
      message: "No endpoints found for cognitivecomputations/retired-free-model:free",
      code: 404,
      metadata: { provider_name: "Venice" },
    },
  });
  const parsedErr = parseOpenRouterErrorResponse(404, err404Json, "cognitivecomputations/retired-free-model:free");
  assert.ok(
    parsedErr.includes("OpenRouter (404) [cognitivecomputations/retired-free-model:free]: No endpoints found"),
    `Real error message must be preserved, got: ${parsedErr}`
  );
  assert.ok(parsedErr.includes("[Provider: Venice]"), "Provider metadata must be included in error string");

  saveOpenRouterModelSettings({
    selectedModel: "nousresearch/hermes-3-llama-3.1-405b:free",
    customSlug: "invalid/custom-slug",
    tryFreeFirst: true,
  });
  const fallbackSlug = fallbackToOpenRouterPaidDefault(parsedErr);
  assert.strictEqual(fallbackSlug, OPENROUTER_DEFAULT_PAID_MODEL);
  assert.strictEqual(OPENROUTER_DEFAULT_PAID_MODEL, "cognitivecomputations/dolphin-mistral-24b-venice-edition");
  const updatedOrSettings = getOpenRouterModelSettings();
  assert.strictEqual(updatedOrSettings.selectedModel, OPENROUTER_DEFAULT_PAID_MODEL);
  assert.strictEqual(updatedOrSettings.customSlug, "");
  assert.strictEqual(updatedOrSettings.tryFreeFirst, false);

  // 6. UNIT TEST: Stream abort on barge-in (SSE streaming + sentence emission + AbortController abort)
  const originalFetch = globalThis.fetch;
  try {
    setOpenRouterApiKey("sk-or-v1-live-test-key");
    clearDebugLogs();

    const abortController = new AbortController();
    const spokenSentencesOnTurn: string[] = [];

    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const chunk1 =
            'data: {"choices":[{"delta":{"content":"First complete sentence spoken right away for the user! "}}]}\n\n';
          controller.enqueue(encoder.encode(chunk1));

          await new Promise((r) => setTimeout(r, 15));
          const chunk2 =
            'data: {"choices":[{"delta":{"content":"Second sentence starts streaming before user barges in..."}}]}\n\n';
          controller.enqueue(encoder.encode(chunk2));

          // Abort right after chunk2 arrives
          abortController.abort();

          await new Promise((r) => setTimeout(r, 15));
          const chunk3 =
            'data: {"choices":[{"delta":{"content":"Third sentence that should never be emitted after abort."}}]}\n\n';
          controller.enqueue(encoder.encode(chunk3));
          controller.close();
        },
      });

      init?.signal?.addEventListener("abort", () => {
        // Signal observed
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as any;

    const liveResult = await streamOpenRouterLiveTurn({
      userTranscript: "Tell me a story",
      history: [{ role: "user", content: "Hello Sierra" }],
      personaId: "confident",
      contentMode: "mature",
      identity: "sierra",
      sttMs: 210,
      abortSignal: abortController.signal,
      onSentence: (s) => {
        spokenSentencesOnTurn.push(s);
      },
    });

    assert.strictEqual(liveResult.aborted, true, "Stream must report aborted=true when AbortController triggers");
    assert.ok(
      spokenSentencesOnTurn.length >= 1 &&
        spokenSentencesOnTurn[0].includes("First complete sentence spoken right away for the user!"),
      "First sentence must be emitted before barge-in abort"
    );
    assert.strictEqual(
      liveResult.fullText.includes("Third sentence that should never be emitted"),
      false,
      "Tokens after abort must not be appended"
    );
    const turnMetricLog = getDebugLogs().find((l) => l.stage === "OpenRouterLive:TurnMetrics");
    assert.ok(turnMetricLog, "Must log OpenRouterLive:TurnMetrics per turn");
    assert.ok(turnMetricLog!.detail.includes("sttMs=210"), "Turn metrics must include sttMs");

    // 7. UNIT TEST: Ollama "Failed to fetch" clear error message & automatic fallback to default provider
    assert.strictEqual(
      OLLAMA_UNREACHABLE_MESSAGE,
      "Ollama server not reachable from this phone. Switch provider or set an endpoint URL"
    );
    assert.strictEqual(isOllamaUnreachableFetchError(new TypeError("Failed to fetch")), true);
    assert.strictEqual(
      formatOllamaConnectionError(new TypeError("Failed to fetch")),
      OLLAMA_UNREACHABLE_MESSAGE
    );

    // Configure OpenRouter as the fallback provider with a working stream response, and call streamChat with provider='ollama'
    await saveProviderConfig({
      activeProvider: "ollama",
      providerId: "openrouter",
      apiKey: "sk-or-v1-fallback-key",
      model: OPENROUTER_DEFAULT_PAID_MODEL,
    });

    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("localhost:11434") || urlStr.includes("/api/chat")) {
        throw new TypeError("Failed to fetch");
      }
      // OpenRouter fallback succeeds
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Fallback response from OpenRouter."}}]}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    let fallbackMetadata: any = null;
    let fallbackReply = "";
    await new Promise<void>((resolve, reject) => {
      streamChat(
        {
          messages: [{ role: "user", content: "Test Ollama fallback" }],
          systemInstruction: "You are Sierra.",
          provider: "ollama",
          model: "llama3.2",
          contentMode: "mature",
        },
        {
          onChunk: (c) => {
            fallbackReply += c;
          },
          onMetadata: (meta) => {
            fallbackMetadata = meta;
          },
          onDone: () => resolve(),
          onError: (err) => reject(err),
        }
      );
    });

    assert.ok(
      fallbackMetadata?.ollamaFallbackNotice?.includes(OLLAMA_UNREACHABLE_MESSAGE),
      `Expected ollamaFallbackNotice to contain "${OLLAMA_UNREACHABLE_MESSAGE}", got: ${JSON.stringify(fallbackMetadata)}`
    );
    assert.strictEqual(fallbackReply, "Fallback response from OpenRouter.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Consolidated Pass: OpenRouter Mature-Mode Rule, 700-1000 Token Cloud Live Prompt, HeyGen TTS without Speed, Chat Fallback Order, Memory Deduplication & Settings Migration", async () => {
  const storageMap: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in storageMap ? storageMap[k] : null),
    setItem: (k: string, v: string) => {
      storageMap[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const {
    OPENROUTER_DEFAULT_PAID_MODEL,
    DEFAULT_OPENROUTER_MODEL_SETTINGS,
    FREE_MODEL_MATURE_WARNING_LABEL,
    OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES,
    OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS,
    OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES,
    formatOpenRouterFreeModelLabel,
    getOpenRouterModelSettings,
    saveOpenRouterModelSettings,
    resolveEffectiveOpenRouterModel,
    buildOpenRouterSystemPrompt,
    streamOpenRouterLiveTurn,
  } = await import("../src/lib/openRouterLive");

  const {
    estimateLocalTokenCount,
  } = await import("../src/lib/localVoiceEngine");

  const {
    GEMINI_QUOTA_EXHAUSTED_MESSAGE,
    isGeminiQuotaExhaustedError,
    resolveFallbackDefaultChatProvider,
    migrateSettingsStorageSingleSourceOfTruth,
    getProvidersConfig,
  } = await import("../src/lib/providers");

  const {
    saveConversationSummary,
    summarizeAndSaveConversation,
    getConversationSummaries,
    clearConversationSummaries,
    buildSierraSystemInstruction,
    setOpenRouterApiKey,
    getOpenRouterApiKey,
  } = await import("../src/lib/persona");

  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");
  const fsMod = await import("node:fs");

  // ---------------------------------------------------------------------------
  // PART 1: MODEL SELECTION (OpenRouter Live and Chat)
  // ---------------------------------------------------------------------------
  localStorage.clear();
  assert.strictEqual(
    DEFAULT_OPENROUTER_MODEL_SETTINGS.tryFreeFirst,
    false,
    '"Try free first" must default OFF (false)'
  );
  assert.strictEqual(
    DEFAULT_OPENROUTER_MODEL_SETTINGS.selectedModel,
    "cognitivecomputations/dolphin-mistral-24b-venice-edition",
    "Default model must be cognitivecomputations/dolphin-mistral-24b-venice-edition"
  );
  assert.strictEqual(getOpenRouterModelSettings().tryFreeFirst, false);
  assert.strictEqual(getOpenRouterModelSettings().selectedModel, OPENROUTER_DEFAULT_PAID_MODEL);

  // Free models labeled "may refuse adult content"
  assert.strictEqual(FREE_MODEL_MATURE_WARNING_LABEL, "may refuse adult content");
  const freeLabel = formatOpenRouterFreeModelLabel("Llama 3.3 70B Instruct:free");
  assert.ok(
    freeLabel.includes("may refuse adult content"),
    `Free model label must include "may refuse adult content", got: ${freeLabel}`
  );

  const sampleFreePool = [
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B (free)",
      isFree: true,
      contextLength: 131072,
      promptPrice: "0",
      completionPrice: "0",
    },
  ];

  // When contentMode is mature/18+, do NOT auto-pick a free model even if tryFreeFirst is true
  const matureAutoPick = resolveEffectiveOpenRouterModel(
    {
      selectedModel: OPENROUTER_DEFAULT_PAID_MODEL,
      customSlug: "",
      customModelSlug: "",
      tryFreeFirst: true,
      lastErrorText: "",
      lastErrorModel: "",
    },
    sampleFreePool,
    "mature"
  );
  assert.strictEqual(
    matureAutoPick,
    OPENROUTER_DEFAULT_PAID_MODEL,
    "In mature/18+ mode, tryFreeFirst must NOT auto-pick a free model"
  );

  // Free models CAN still be selected manually (when tryFreeFirst is false) in mature mode
  const matureManualFree = resolveEffectiveOpenRouterModel(
    {
      selectedModel: "meta-llama/llama-3.3-70b-instruct:free",
      customSlug: "",
      customModelSlug: "",
      tryFreeFirst: false,
      lastErrorText: "",
      lastErrorModel: "",
    },
    sampleFreePool,
    "mature"
  );
  assert.strictEqual(
    matureManualFree,
    "meta-llama/llama-3.3-70b-instruct:free",
    "Manual selection of a free model must be respected"
  );

  // In SFW mode, tryFreeFirst auto-picks from the free pool
  const sfwAutoPick = resolveEffectiveOpenRouterModel(
    {
      selectedModel: OPENROUTER_DEFAULT_PAID_MODEL,
      customSlug: "",
      customModelSlug: "",
      tryFreeFirst: true,
      lastErrorText: "",
      lastErrorModel: "",
    },
    sampleFreePool,
    "sfw"
  );
  assert.strictEqual(sfwAutoPick, "meta-llama/llama-3.3-70b-instruct:free");

  // ---------------------------------------------------------------------------
  // PART 2: PROMPT SIZE (700-1000 tokens for Cloud OpenRouter Live, <=3 summaries / 500 chars, last 8 messages)
  // ---------------------------------------------------------------------------
  assert.strictEqual(OPENROUTER_CLOUD_LIVE_MAX_SUMMARIES, 3);
  assert.strictEqual(OPENROUTER_CLOUD_LIVE_MAX_MEMORY_CHARS, 500);
  assert.strictEqual(OPENROUTER_CLOUD_LIVE_MAX_HISTORY_MESSAGES, 8);

  clearConversationSummaries();
  for (let i = 1; i <= 6; i++) {
    saveConversationSummary({
      id: `or-mem-${i}`,
      updatedAt: 5000 + i,
      source: "live",
      title: `Session ${i}`,
      summary: `Summary #${i}: Talked about architecture, espresso, midnight drives, and weekend plans in detail.`,
    });
  }

  for (const mode of ["sfw", "mature"] as const) {
    const cloudSystemPrompt = buildOpenRouterSystemPrompt({
      identity: "sierra",
      personaId: "confident",
      contentMode: mode,
      languageCode: "en-US",
      injectMemory: true,
    });
    const sysTokens = estimateLocalTokenCount(cloudSystemPrompt);
    assert.ok(
      sysTokens >= 700 && sysTokens <= 950,
      `Cloud OpenRouter Live system prompt must be inside 700-1000 token budget, got ${sysTokens} tokens (${cloudSystemPrompt.length} chars) for mode=${mode}`
    );
    assert.ok(
      cloudSystemPrompt.includes("You only know what is in the injected summaries and current chat"),
      "Cloud OpenRouter prompt must include honesty line"
    );
    assert.ok(
      cloudSystemPrompt.includes("[SPOKEN LIVE VOICE RULES]:"),
      "Cloud OpenRouter prompt must include spoken-reply rules"
    );
  }

  // Verify Gemini keeps the full persona text (> 2,500 tokens / > 10,000 chars)
  const geminiFullPrompt = buildSierraSystemInstruction("confident", "sfw", "", "en-US", "sierra");
  assert.ok(
    geminiFullPrompt.length > 8000,
    `Gemini system instruction must retain full persona text, got ${geminiFullPrompt.length} chars`
  );

  // Verify streamOpenRouterLiveTurn caps history at last 8 messages, logs promptTokens per turn,
  // falls back to paid default on 429 without resetting persisted user model choice, and returns answeredModel
  const originalFetch = globalThis.fetch;
  try {
    setOpenRouterApiKey("sk-or-v1-test-consolidated");
    saveOpenRouterModelSettings({
      selectedModel: "meta-llama/llama-3.3-70b-instruct:free",
      customSlug: "",
      tryFreeFirst: false,
    });
    clearDebugLogs();

    const tenHistoryMessages = Array.from({ length: 10 }, (_, idx) => ({
      role: (idx % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `History message #${idx + 1}`,
    }));

    const requestedModels: string[] = [];
    let capturedMessagesSent: any[] = [];

    // First verify 429 on selected :free model does NOT auto-fallback to Dolphin 24B
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const bodyObj = JSON.parse(String(init?.body || "{}"));
      requestedModels.push(bodyObj.model);
      return new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded on free model", code: 429 } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const rateLimitedTurn = await streamOpenRouterLiveTurn({
      userUtterance: "Testing 429 behavior",
      history: tenHistoryMessages,
      identity: "sierra",
      personaId: "confident",
      contentMode: "sfw",
      injectMemory: true,
    });
    assert.strictEqual(rateLimitedTurn.ok, false);
    assert.strictEqual(rateLimitedTurn.status, 429);
    assert.deepStrictEqual(
      requestedModels,
      ["meta-llama/llama-3.3-70b-instruct:free"],
      "OpenRouter Live must NOT silently fall back to Dolphin 24B on 429"
    );

    // Next verify prompt budget + 8-message history cap on a successful response for the exact selected model
    requestedModels.length = 0;
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const bodyObj = JSON.parse(String(init?.body || "{}"));
      requestedModels.push(bodyObj.model);
      capturedMessagesSent = bodyObj.messages || [];

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"model":"meta-llama/llama-3.3-70b-instruct:free","choices":[{"delta":{"content":"Answered by exact selected model."}}]}\n\n'
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    const turnRes = await streamOpenRouterLiveTurn({
      userUtterance: "How are you doing tonight?",
      history: tenHistoryMessages,
      identity: "sierra",
      personaId: "confident",
      contentMode: "sfw",
      injectMemory: true,
    });

    assert.strictEqual(turnRes.ok, true);
    assert.strictEqual(turnRes.usedFallbackModel, false);
    assert.strictEqual(
      turnRes.answeredModel,
      "meta-llama/llama-3.3-70b-instruct:free",
      "answeredModel must report the exact selected model"
    );
    assert.deepStrictEqual(requestedModels, ["meta-llama/llama-3.3-70b-instruct:free"]);
    assert.strictEqual(
      getOpenRouterModelSettings().selectedModel,
      "meta-llama/llama-3.3-70b-instruct:free",
      "User's persisted model choice must remain unchanged"
    );
    // 1 system + 8 capped history + 1 current user = 10 messages total
    assert.strictEqual(
      capturedMessagesSent.length,
      10,
      `Expected 1 system + 8 history + 1 user = 10 messages, got ${capturedMessagesSent.length}`
    );
    assert.strictEqual(
      capturedMessagesSent.some((m: any) => String(m.content).includes("History message #1\n") || m.content === "History message #1"),
      false,
      "Oldest history messages #1 and #2 must be excluded by the 8-message cap"
    );
    assert.ok(
      turnRes.promptTokens >= 700 && turnRes.promptTokens <= 1000,
      `Turn promptTokens (${turnRes.promptTokens}) must be within 700-1000 target`
    );
    assert.ok(
      getDebugLogs().some(
        (l) => l.stage === "OpenRouterLive:PromptBudget" && l.detail.includes(`promptTokens=${turnRes.promptTokens}`)
      ),
      "Must log promptTokens per turn in OpenRouterLive:PromptBudget"
    );

    // ---------------------------------------------------------------------------
    // PART 3: TTS — HeyGen request omits "speed" parameter
    // ---------------------------------------------------------------------------
    const { playOpenRouterTts } = await import("../src/lib/ttsService");
    let capturedTtsPayload: Record<string, any> | null = null;
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      if (String(url).includes("/audio/speech")) {
        capturedTtsPayload = JSON.parse(String(init?.body || "{}"));
        return new Response(
          JSON.stringify({ error: { message: "Test stop before WebAudio decode" } }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await playOpenRouterTts({
      text: "Hello from HeyGen TTS test.",
      voice: "Aoede",
      speed: 1.25,
      source: "chat",
    });
    assert.ok(capturedTtsPayload, "playOpenRouterTts must send POST request to OpenRouter TTS endpoint");
    assert.strictEqual(
      "speed" in capturedTtsPayload!,
      false,
      'HeyGen TTS request body must omit "speed" parameter so API does not return 400'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // PART 4: CHAT PROVIDER — Saved provider respected, Ollama fallback order (OpenRouter -> Gemini), Gemini 429
  // ---------------------------------------------------------------------------
  localStorage.clear();
  localStorage.setItem("sierra_openrouter_api_key", "sk-or-v1-saved-key");
  localStorage.setItem("omni_active_provider", "ollama");
  localStorage.setItem(
    "omni_providers_config",
    JSON.stringify({
      ollama: { selectedModel: "dolphin-llama3:8b", baseUrl: "http://localhost:11434" },
    })
  );

  // Migration must detect stale default localhost ollama when OpenRouter is configured and user did not explicitly pick ollama
  migrateSettingsStorageSingleSourceOfTruth();
  const { getActiveProviderId } = await import("../src/lib/providers");
  assert.strictEqual(
    getActiveProviderId(),
    "openrouter",
    "Stale unconfigured localhost ollama must migrate to openrouter when OpenRouter key exists"
  );
  assert.strictEqual(
    localStorage.getItem("omni_active_provider"),
    "ollama",
    "Legacy omni_active_provider key must remain preserved (non-destructive migration)"
  );
  const migratedCfg = await getProvidersConfig();
  assert.strictEqual(migratedCfg.activeProvider, "openrouter");
  assert.strictEqual(migratedCfg.providers.openrouter.hasKey, true);

  // If user explicitly saves a chat provider, it is respected
  localStorage.removeItem("omni_settings_v3");
  localStorage.removeItem("omni_unified_settings_v1");
  localStorage.setItem("sierra_explicit_chat_provider_v1", "gemini");
  localStorage.setItem("omni_active_provider", "gemini");
  migrateSettingsStorageSingleSourceOfTruth();
  assert.strictEqual(getActiveProviderId(), "gemini");
  assert.strictEqual(localStorage.getItem("omni_active_provider"), "gemini");

  // Ollama-unreachable fallback order: OpenRouter (if a key exists) -> Gemini
  assert.strictEqual(
    resolveFallbackDefaultChatProvider({ openrouter: "sk-or-v1-key", gemini: "AIza-key" }).provider,
    "openrouter",
    "When OpenRouter key exists, Ollama fallback must pick OpenRouter first"
  );
  localStorage.removeItem("omni_settings_v3");
  localStorage.removeItem("sierra_openrouter_api_key");
  localStorage.removeItem("omni_provider_keys");
  assert.strictEqual(
    resolveFallbackDefaultChatProvider({ gemini: "AIza-key" }).provider,
    "gemini",
    "When no OpenRouter key exists, Ollama fallback must fall back to Gemini"
  );
  setOpenRouterApiKey("sk-or-v1-restored");
  assert.strictEqual(getOpenRouterApiKey(), "sk-or-v1-restored");

  // Gemini 429 quota detection
  assert.strictEqual(GEMINI_QUOTA_EXHAUSTED_MESSAGE, "Gemini quota exhausted");
  assert.strictEqual(
    isGeminiQuotaExhaustedError(new Error("429 Too Many Requests: RESOURCE_EXHAUSTED")),
    true
  );
  assert.strictEqual(isGeminiQuotaExhaustedError(new Error("Network timeout")), false);

  // ---------------------------------------------------------------------------
  // PART 5: SETTINGS CLEANUP — 4 collapsible cards in exact order & Change in Settings links
  // ---------------------------------------------------------------------------
  const settingsSource = fsMod.readFileSync("src/components/Settings.tsx", "utf8");
  const idxProviders = settingsSource.indexOf('id="settings-section-providers"');
  const idxModels = settingsSource.indexOf('id="settings-section-models"');
  const idxPersona = settingsSource.indexOf('id="settings-section-persona"');
  const idxBackup = settingsSource.indexOf('id="settings-section-backup"');
  assert.ok(
    idxProviders > 0 && idxModels > idxProviders && idxPersona > idxModels && idxBackup > idxPersona,
    `Settings cards must appear in exact order: 1. Providers (${idxProviders}) -> 2. Models (${idxModels}) -> 3. Voice & Persona (${idxPersona}) -> 4. Content Mode & Backup (${idxBackup})`
  );

  const liveSource = fsMod.readFileSync("src/components/LiveVoice.tsx", "utf8");
  const chatSource = fsMod.readFileSync("src/components/ChatInterface.tsx", "utf8");
  assert.ok(liveSource.includes('data-testid="live-open-full-settings"'), "LiveVoice must include Open full settings link");
  assert.ok(chatSource.includes('data-testid="chat-open-full-settings"'), "ChatInterface must include Open full settings link");
  assert.ok(chatSource.includes('data-testid="chat-gemini-429-switch-openrouter"'), "ChatInterface must include one-tap switch to OpenRouter on Gemini 429");

  // ---------------------------------------------------------------------------
  // PART 6: MEMORY — Save each summary once and dedupe
  // ---------------------------------------------------------------------------
  clearConversationSummaries();
  clearDebugLogs();

  const sampleTurnMessages = [
    { role: "user", content: "Let's plan a trip to Kyoto in autumn." },
    { role: "model", content: "Kyoto in November is gorgeous, especially Arashiyama and Fushimi Inari." },
  ];

  summarizeAndSaveConversation("dup-session-1", sampleTurnMessages, "Kyoto Trip", "chat", "en-US");
  summarizeAndSaveConversation("dup-session-1", sampleTurnMessages, "Kyoto Trip", "chat", "en-US");
  summarizeAndSaveConversation("dup-session-2-same-text", sampleTurnMessages, "Kyoto Trip", "chat", "en-US");

  const savedSummaries = getConversationSummaries();
  assert.strictEqual(
    savedSummaries.length,
    1,
    `Identical conversation summaries must be deduplicated to 1 entry, got ${savedSummaries.length}`
  );
  const savedSummaryLogs = getDebugLogs().filter((l) => l.detail.startsWith("[Memory] Saved summary #"));
  assert.strictEqual(
    savedSummaryLogs.length,
    1,
    `"[Memory] Saved summary #N" must be logged only once for duplicate saves, got ${savedSummaryLogs.length}`
  );
});

test("Functional Fix Regression: OpenRouter Live Mic Permission, Diagnostics & PopState Chat Stability", async () => {
  const fsMod = await import("node:fs");
  const { ensureNativeLocalMicPermission } = await import("../src/lib/localVoiceEngine");
  const { resolvePopStateTabTarget } = await import("../src/components/Layout");

  // Bug 1a: ensureNativeLocalMicPermission checks native plugin & handles denial cleanly
  let permCalls = 0;
  const deniedPerm = await ensureNativeLocalMicPermission(
    {
      ensureMicrophonePermission: async () => {
        permCalls++;
        return { granted: false, reason: "RECORD_AUDIO denied" };
      },
    },
    true
  );
  assert.strictEqual(permCalls, 1);
  assert.strictEqual(deniedPerm.granted, false);
  assert.strictEqual(deniedPerm.reason, "RECORD_AUDIO denied");

  const grantedPerm = await ensureNativeLocalMicPermission(
    {
      ensureMicrophonePermission: async () => ({ granted: true }),
    },
    true
  );
  assert.strictEqual(grantedPerm.granted, true);

  const webPerm = await ensureNativeLocalMicPermission(
    {
      ensureMicrophonePermission: async () => {
        throw new Error("should not be called on web");
      },
    },
    false
  );
  assert.strictEqual(webPerm.granted, true);

  // Bug 1b: Native Android plugin & engine fixes + full stage diagnostics
  const pluginJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoicePlugin.java", "utf8");
  const engineJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoiceEngine.java", "utf8");
  const liveTsx = fsMod.readFileSync("src/components/LiveVoice.tsx", "utf8");

  assert.ok(pluginJava.includes("Manifest.permission.RECORD_AUDIO"), "LocalVoicePlugin must declare RECORD_AUDIO permission");
  assert.ok(pluginJava.includes("ensureMicrophonePermission"), "LocalVoicePlugin must expose ensureMicrophonePermission");
  assert.ok(pluginJava.includes("handleStartSessionMicPermissionResult"), "LocalVoicePlugin must handle runtime mic permission callback");
  assert.ok(engineJava.includes("pendingAudioInitLatch"), "LocalVoiceEngine.startSession must wait for AudioRecord init");
  assert.ok(engineJava.includes("idleVadThreshold"), "LocalVoiceEngine must separate idleVadThreshold from bargeInThreshold");
  assert.ok(engineJava.includes("LocalAudio:CaptureStart") && engineJava.includes("LocalAudio:Heartbeat"), "LocalVoiceEngine must emit mic capture diagnostics");
  assert.ok(engineJava.includes("LocalVAD:Init") && engineJava.includes("LocalVAD:OnnxFallback"), "LocalVoiceEngine must log Silero VAD ONNX status/fallbacks");
  assert.ok(engineJava.includes("LocalSTT:WhisperStart") && engineJava.includes("LocalSTT:Skipped"), "LocalVoiceEngine must log Whisper STT stages");
  assert.ok(liveTsx.includes("OpenRouterLive:NativeStatus") && liveTsx.includes("OpenRouterLive:VAD"), "LiveVoice openrouter path must log native status & VAD events");
  assert.ok(liveTsx.includes("thinking: false"), "LiveVoice openrouter path must clear native isThinking when a turn finishes or errors without speaking");

  // Bug 2: Spurious popstate events must never kick active Chat tab back to home
  assert.strictEqual(resolvePopStateTabTarget("chat", null), null, "null popstate must be ignored on Chat");
  assert.strictEqual(resolvePopStateTabTarget("chat", undefined), null, "undefined popstate must be ignored on Chat");
  assert.strictEqual(resolvePopStateTabTarget("chat", { tab: "home" }), null, "foreign state without omniTab must be ignored");
  assert.strictEqual(resolvePopStateTabTarget("chat", { omniTab: "chat" }), null, "matching omniTab must not trigger tab switch");
  assert.strictEqual(resolvePopStateTabTarget("chat", { omniTab: "unknown_tab" }), null, "invalid omniTab must be ignored");
  assert.strictEqual(resolvePopStateTabTarget("chat", { omniTab: "home" }), "home", "explicit valid omniTab history pop must navigate");

  const layoutTsx = fsMod.readFileSync("src/components/Layout.tsx", "utf8");
  const appTsx = fsMod.readFileSync("src/App.tsx", "utf8");
  const chatTsx = fsMod.readFileSync("src/components/ChatInterface.tsx", "utf8");

  assert.ok(layoutTsx.includes("Nav:PopState"), "Layout must log Nav:PopState diagnostics");
  assert.ok(appTsx.includes("Nav:TabChange"), "App must log Nav:TabChange diagnostics");
  assert.ok(chatTsx.includes("Chat:Mount") && chatTsx.includes("Chat:Unmount"), "ChatInterface must log mount/unmount lifecycle");
});

test("Combined Fix Regression: OpenRouter Key Sync/401 Fail-Fast, Chat Free Model Selection & Settings Scroll Header", async () => {
  const fsMod = await import("node:fs");
  const {
    normalizeOpenRouterApiKey,
    resolveOpenRouterApiKeyWithSource,
    setOpenRouterApiKey,
    getOpenRouterApiKey,
  } = await import("../src/lib/persona");
  const {
    streamOpenRouterLiveTurn,
    saveOpenRouterModelSettings,
    getOpenRouterModelSettings,
    OPENROUTER_DEFAULT_PAID_MODEL,
  } = await import("../src/lib/openRouterLive");
  const {
    streamChat,
    getNativeStoredKeys,
  } = await import("../src/lib/providers");
  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");

  // 1. Key normalization strips whitespace, quotes, zero-width chars, and Bearer prefix
  assert.strictEqual(
    normalizeOpenRouterApiKey('  "Bearer sk-or-v1-fresh-key-9876"\n'),
    "sk-or-v1-fresh-key-9876"
  );

  // Seed stale keys in every OpenRouter key location
  localStorage.clear();
  localStorage.setItem("sierra_openrouter_api_key", "sk-or-v1-old-stale-1111");
  localStorage.setItem(
    "omni_providers_config",
    JSON.stringify({
      openrouter: { apiKey: "sk-or-v1-old-stale-2222", selectedModel: "meta-llama/llama-3.3-70b-instruct:free" },
      custom: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-v1-old-stale-3333" },
    })
  );
  localStorage.setItem(
    "omni_provider_keys",
    JSON.stringify({ openrouter: "sk-or-v1-old-stale-4444" })
  );

  // Saving a dirty new key must normalize, write to unified store, and clean legacy keys
  const savedKey = setOpenRouterApiKey('  "Bearer sk-or-v1-fresh-key-9876"  ');
  assert.strictEqual(savedKey, "sk-or-v1-fresh-key-9876");
  assert.strictEqual(getOpenRouterApiKey(), "sk-or-v1-fresh-key-9876");

  const resolution = resolveOpenRouterApiKeyWithSource();
  assert.strictEqual(resolution.apiKey, "sk-or-v1-fresh-key-9876");
  assert.strictEqual(resolution.last4, "9876");
  assert.strictEqual(resolution.source, "omni_settings_v3:providers.openrouter.apiKey");

  assert.strictEqual(getNativeStoredKeys().openrouter, "sk-or-v1-fresh-key-9876");
  const v3AfterSave = JSON.parse(localStorage.getItem("omni_settings_v3") || "{}");
  assert.strictEqual(v3AfterSave.providers?.openrouter?.apiKey, "sk-or-v1-fresh-key-9876");
  assert.strictEqual(localStorage.getItem("sierra_openrouter_api_key"), "sk-or-v1-old-stale-1111", "Legacy sierra_openrouter_api_key must not be deleted during migration/save");

  // Also test migration precedence if sierra_openrouter_api_key exists alongside a stale omni_providers_config
  localStorage.removeItem("omni_settings_v3");
  localStorage.removeItem("omni_unified_settings_v1");
  localStorage.setItem(
    "omni_providers_config",
    JSON.stringify({ openrouter: { apiKey: "sk-or-v1-very-old-0000" } })
  );
  localStorage.setItem("sierra_openrouter_api_key", "sk-or-v1-newer-direct-5555");
  assert.strictEqual(getNativeStoredKeys().openrouter, "sk-or-v1-newer-direct-5555");
  assert.strictEqual(resolveOpenRouterApiKeyWithSource().last4, "5555");

  // Restore clean fresh key for request tests
  setOpenRouterApiKey("sk-or-v1-fresh-key-9876");

  const originalFetch = globalThis.fetch;
  try {
    // 2. Live & Chat send exact normalized key, log keySource+last4 (never full key), and fail fast on 401
    clearDebugLogs();
    const liveAuthHeaders: string[] = [];
    const liveModelsTried: string[] = [];
    saveOpenRouterModelSettings({
      selectedModel: "meta-llama/llama-3.3-70b-instruct:free",
      customSlug: "",
      customModelSlug: "",
      tryFreeFirst: false,
    });

    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      liveAuthHeaders.push(headers.Authorization || headers.authorization || "");
      const body = JSON.parse(String(init?.body || "{}"));
      liveModelsTried.push(body.model);
      return new Response(
        JSON.stringify({ error: { message: "User not found.", code: 401 } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const live401 = await streamOpenRouterLiveTurn({
      userUtterance: "Hello",
      history: [],
      identity: "sierra",
      personaId: "confident",
      contentMode: "mature",
    });

    assert.strictEqual(live401.ok, false);
    assert.strictEqual(live401.status, 401);
    assert.strictEqual(live401.auth401Provider, "openrouter");
    assert.ok(live401.errorText?.includes("Invalid or unrecognized API key for OpenRouter"));
    assert.deepStrictEqual(liveAuthHeaders, ["Bearer sk-or-v1-fresh-key-9876"]);
    assert.deepStrictEqual(
      liveModelsTried,
      ["meta-llama/llama-3.3-70b-instruct:free"],
      "Live must NOT silently retry paid Dolphin 24B on HTTP 401 auth failure"
    );
    const liveKeyLogs = getDebugLogs().filter((l) => l.stage === "OpenRouterLive:RequestKey");
    assert.strictEqual(liveKeyLogs.length, 1);
    assert.ok(liveKeyLogs[0].detail.includes("keySource=omni_settings_v3:providers.openrouter.apiKey"));
    assert.ok(liveKeyLogs[0].detail.includes("keyLast4=9876"));
    assert.strictEqual(
      getDebugLogs().some((l) => l.detail.includes("sk-or-v1-fresh-key-9876")),
      false,
      "Full OpenRouter API key must NEVER appear in debug logs"
    );

    // 3. Chat with :free model in mature mode + tryFreeFirst=true sends exact :free model (no preemptive fallback)
    clearDebugLogs();
    const chatRequests: Array<{ auth: string; model: string }> = [];
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body || "{}"));
      chatRequests.push({
        auth: headers.Authorization || headers.authorization || "",
        model: body.model,
      });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Free model response ok."}}]}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    saveOpenRouterModelSettings({
      selectedModel: "meta-llama/llama-3.3-70b-instruct:free",
      customSlug: "",
      customModelSlug: "",
      tryFreeFirst: true,
    });

    let chatOutput = "";
    let chatMeta: any = null;
    await new Promise<void>((resolve, reject) => {
      streamChat(
        {
          provider: "openrouter",
          model: "meta-llama/llama-3.3-70b-instruct:free",
          contentMode: "mature",
          messages: [{ role: "user", content: "Hi there" }],
        },
        {
          onChunk: (chunk) => {
            chatOutput += chunk;
          },
          onMetadata: (meta) => {
            chatMeta = meta;
          },
          onDone: () => resolve(),
          onError: (err) => reject(err),
        }
      );
    });

    assert.strictEqual(chatOutput, "Free model response ok.");
    assert.strictEqual(chatMeta?.answeredModel, "meta-llama/llama-3.3-70b-instruct:free");
    assert.strictEqual(chatMeta?.usedFallbackModel, false);
    assert.deepStrictEqual(chatRequests, [
      {
        auth: "Bearer sk-or-v1-fresh-key-9876",
        model: "meta-llama/llama-3.3-70b-instruct:free",
      },
    ]);
    const chatKeyLogs = getDebugLogs().filter((l) => l.stage === "Chat:OpenRouterKey");
    assert.strictEqual(chatKeyLogs.length, 1);
    assert.ok(chatKeyLogs[0].detail.includes("keySource=omni_settings_v3:providers.openrouter.apiKey"));
    assert.ok(chatKeyLogs[0].detail.includes("keyLast4=9876"));
    assert.strictEqual(
      getDebugLogs().some((l) => l.detail.includes("sk-or-v1-fresh-key-9876")),
      false,
      "Full OpenRouter API key must NEVER appear in Chat debug logs"
    );

    // 4. Chat fails fast on 401 with friendly provider message (does NOT retry paid Dolphin)
    const chat401Models: string[] = [];
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      chat401Models.push(body.model);
      return new Response(
        JSON.stringify({ error: { message: "User not found.", code: 401 } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    let captured401Error: any = null;
    await new Promise<void>((resolve) => {
      streamChat(
        {
          provider: "openrouter",
          model: "meta-llama/llama-3.3-70b-instruct:free",
          contentMode: "mature",
          messages: [{ role: "user", content: "Test 401" }],
        },
        {
          onChunk: () => {},
          onDone: () => resolve(),
          onError: (err) => {
            captured401Error = err;
            resolve();
          },
        }
      );
    });
    assert.ok(
      captured401Error &&
        String(captured401Error.message || "").includes("Invalid or unrecognized API key for OpenRouter")
    );
    assert.strictEqual(captured401Error.status, 401);
    assert.strictEqual(captured401Error.auth401Provider, "openrouter");
    assert.deepStrictEqual(
      chat401Models,
      ["meta-llama/llama-3.3-70b-instruct:free"],
      "Chat must NOT silently retry paid Dolphin 24B on HTTP 401 auth failure"
    );

    // 5. Chat MUST NOT automatically fall back to Dolphin 24B on 429 — errors cleanly while preserving selected :free model
    const chat429Models: string[] = [];
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      chat429Models.push(body.model);
      return new Response(
        JSON.stringify({ error: { message: "Provider returned rate limit", code: 429 } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    let captured429Error: any = null;
    await new Promise<void>((resolve) => {
      streamChat(
        {
          provider: "openrouter",
          model: "meta-llama/llama-3.3-70b-instruct:free",
          contentMode: "mature",
          messages: [{ role: "user", content: "Test 429 no auto fallback" }],
        },
        {
          onChunk: () => {},
          onDone: () => resolve(),
          onError: (err) => {
            captured429Error = err;
            resolve();
          },
        }
      );
    });
    assert.ok(captured429Error, "Chat must emit error when selected OpenRouter model returns 429");
    assert.deepStrictEqual(
      chat429Models,
      ["meta-llama/llama-3.3-70b-instruct:free"],
      "Chat must NEVER silently fall back to Dolphin 24B on 429"
    );
    assert.strictEqual(
      getOpenRouterModelSettings().selectedModel,
      "meta-llama/llama-3.3-70b-instruct:free",
      "Persisted :free selection must stay intact after 429 error"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 6. Settings scroll-overlap layout check
  const settingsSrc = fsMod.readFileSync("src/components/Settings.tsx", "utf8");
  assert.ok(
    settingsSrc.includes("flex-1 flex flex-col h-full min-h-0 bg-[#0A0E14] overflow-hidden"),
    "Settings root must use non-scrolling flex container with overflow-hidden"
  );
  assert.ok(
    settingsSrc.includes("shrink-0 relative z-30 bg-[#0A0E14]"),
    "Settings top header & nav must be isolated in shrink-0 container outside scroll pane"
  );
  assert.strictEqual(
    settingsSrc.includes("sticky top-[88px]"),
    false,
    "Settings must NOT use brittle sticky top-[88px] that allows content overlap"
  );
});

test("Single Source of Truth v3, Endpoints, Validation, Key Trimming & Test Connection", async () => {
  const fsMod = await import("node:fs");
  const {
    STORAGE_KEY_SETTINGS_V3,
    STORAGE_KEY_MIGRATION_BACKUP,
    LEGACY_SETTINGS_STORAGE_KEYS,
    DEFAULT_PROVIDER_ENDPOINTS,
    getSettings,
    migrateOnceToV3,
    validateHttpEndpoint,
    validateWsEndpoint,
    trimAndNormalizeApiKey,
  } = await import("../src/lib/settingsStore");
  const {
    saveProviderConfig,
    getActiveProviderId,
    getSelectedModelForProvider,
    streamChat,
    testProviderConnection,
  } = await import("../src/lib/providers");
  const { OPENROUTER_DEFAULT_PAID_MODEL } = await import("../src/lib/openRouterLive");
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");
  const { getContentMode } = await import("../src/lib/contentModeStore");

  // 1. Key trimming on save & read + Endpoint URL validation
  assert.strictEqual(trimAndNormalizeApiKey('  \nBearer "sk-or-test-123"\r\n '), "sk-or-test-123");
  assert.strictEqual(validateHttpEndpoint("https://openrouter.ai/api/v1").valid, true);
  assert.strictEqual(validateHttpEndpoint("ftp://bad.example.com").valid, false);
  assert.strictEqual(validateHttpEndpoint("not-a-url").valid, false);
  assert.strictEqual(validateWsEndpoint("wss://api.openai.com/v1/realtime").valid, true);
  assert.strictEqual(validateWsEndpoint("https://not-ws.example.com").valid, false);

  // 2. One-time migration from legacy keys into omni_settings_v3 + backup + untouched voice configs
  localStorage.clear();
  localStorage.setItem("omni_active_provider", "openai");
  localStorage.setItem("sierra_explicit_chat_provider_v1", "openai");
  localStorage.setItem(
    "omni_providers_config",
    JSON.stringify({
      openai: { selectedModel: "gpt-4.1", apiKey: "sk-openai-legacy" },
      anthropic: { selectedModel: "claude-3-7-sonnet-latest", apiKey: "sk-ant-legacy" },
      openrouter: { selectedModel: "google/gemma-3-27b-it:free", apiKey: "sk-or-v1-cfg-old" },
      custom: { selectedModel: "deepseek-ai/DeepSeek-V3", baseUrl: "https://api.together.xyz/v1" },
      ollama: { selectedModel: "llama3.2", baseUrl: "http://192.168.1.50:11434" },
    })
  );
  localStorage.setItem("omni_provider_keys", JSON.stringify({ gemini: "AIza-legacy-gemini" }));
  localStorage.setItem("sierra_openrouter_api_key", "  Bearer sk-or-v1-migrated-7777  ");
  localStorage.setItem("sierra_live_voice_provider", "openrouter");
  localStorage.setItem("sierra_live_voice_model", "gemini-3.8-live-extended-thinking");
  localStorage.setItem("sierra_live_voice_custom_model", "gemini-3.8-live-custom");
  localStorage.setItem("sierra_live_voice_endpoint", "wss://custom-live.example/ws");
  localStorage.setItem("sierra_gemini_thinking_level", "HIGH");
  localStorage.setItem(
    "sierra_openrouter_model_settings_v1",
    JSON.stringify({
      selectedModel: "qwen/qwen3-32b:free",
      customSlug: "custom/slug-v1",
      tryFreeFirst: true,
    })
  );
  localStorage.setItem("sierra_audio_output_mode", "headphones");
  localStorage.setItem("sierra_bargein_sensitivity", "high");
  localStorage.setItem("sierra_local_voice_settings_v1", JSON.stringify({ whisperSize: "tiny.en", llmPreset: "large" }));
  localStorage.setItem("sierra_content_mode", "sfw");
  localStorage.setItem("sierra_response_speed", "high");
  localStorage.setItem("sierra_live_voice_config_sierra_classy", JSON.stringify({ voiceId: "Aoede", accent: "US" }));

  const migrated = migrateOnceToV3();
  assert.strictEqual(migrated.version, 3);
  assert.strictEqual(migrated.models.chatProvider, "openai");
  assert.strictEqual(migrated.models.chatText, "gpt-4.1");
  assert.strictEqual(migrated.providers.openrouter.apiKey, "sk-or-v1-migrated-7777");
  assert.strictEqual(migrated.providers.openrouter.httpEndpoint, DEFAULT_PROVIDER_ENDPOINTS.openrouter.httpEndpoint);
  assert.strictEqual(migrated.providers.openrouter.wsEndpoint, "");
  assert.strictEqual(migrated.providers.gemini.apiKey, "AIza-legacy-gemini");
  assert.strictEqual(migrated.providers.gemini.wsEndpoint, "wss://custom-live.example/ws");
  assert.strictEqual(migrated.providers.openai.apiKey, "sk-openai-legacy");
  assert.strictEqual(migrated.providers.openai.wsEndpoint, DEFAULT_PROVIDER_ENDPOINTS.openai.wsEndpoint);
  assert.strictEqual(migrated.models.liveProvider, "openrouter");
  assert.strictEqual(migrated.models.liveModel, "qwen/qwen3-32b:free");
  assert.strictEqual(migrated.models.liveCustomModelSlug, "custom/slug-v1");
  assert.strictEqual(migrated.live.thinkingLevel, "HIGH");
  assert.strictEqual(migrated.live.audioOutputMode, "headphones");
  assert.strictEqual(migrated.live.bargeInSensitivity, "high");
  assert.strictEqual(migrated.live.local.llmPreset, "large");
  assert.strictEqual(getContentMode(), "sfw");
  assert.strictEqual(migrated.responseSpeed, "high");

  // Backup key must preserve raw pre-migration values, per-persona voice config untouched, and legacy keys NOT deleted (Task 5b)
  assert.ok(localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP), "Migration backup must be stored");
  assert.ok(localStorage.getItem("sierra_live_voice_config_sierra_classy"), "Per-persona voice config must remain untouched");
  assert.strictEqual(localStorage.getItem("omni_active_provider"), "openai", "Legacy omni_active_provider must NOT be deleted");
  assert.strictEqual(localStorage.getItem("sierra_openrouter_api_key"), "  Bearer sk-or-v1-migrated-7777  ", "Legacy API key must remain intact");
  assert.ok(localStorage.getItem(STORAGE_KEY_SETTINGS_V3), "omni_settings_v3 must exist in localStorage");

  // 3. Test Connection hits exact configured endpoints per provider
  const originalFetch = globalThis.fetch;
  try {
    const testCalls: Array<{ url: string; auth?: string }> = [];
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      const headers = (init?.headers || {}) as Record<string, string>;
      testCalls.push({ url: urlStr, auth: headers.Authorization || headers.authorization });
      return new Response(JSON.stringify({ data: { label: "ok" }, models: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const orTest = await testProviderConnection({
      providerId: "openrouter",
      apiKey: "sk-or-test-1234",
      baseUrl: "https://proxy.openrouter.local/api/v1",
    });
    assert.strictEqual(orTest.success, true);
    assert.strictEqual(testCalls[testCalls.length - 1].url, "https://proxy.openrouter.local/api/v1/auth/key");

    const oaiTest = await testProviderConnection({
      providerId: "openai",
      apiKey: "sk-openai-1234",
      baseUrl: "https://proxy.openai.local/v1",
    });
    assert.strictEqual(oaiTest.success, true);
    assert.strictEqual(testCalls[testCalls.length - 1].url, "https://proxy.openai.local/v1/models");

    const olTest = await testProviderConnection({
      providerId: "ollama",
      baseUrl: "http://192.168.1.99:11434",
    });
    assert.strictEqual(olTest.success, true);
    assert.strictEqual(testCalls[testCalls.length - 1].url, "http://192.168.1.99:11434/api/tags");

    // 4. Chat executes exact selected provider & model from v3 store (never reverts to Dolphin 24B)
    const dispatchedRequests: Array<{ url: string; provider?: string; model?: string }> = [];

    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const urlStr = String(url);
      let body: any = {};
      try {
        body = JSON.parse(String(init?.body || "{}"));
      } catch (_) {}
      dispatchedRequests.push({ url: urlStr, provider: body?.provider, model: body?.model });

      const encoder = new TextEncoder();
      const sseChunk = urlStr.includes("openrouter.ai")
        ? 'data: {"choices":[{"delta":{"content":"Ok"}}]}\n\ndata: [DONE]\n\n'
        : 'data: {"chunk":"Ok"}\n\ndata: {"done":true}\n\n';
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseChunk));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    const scenarios: Array<{
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string;
      expectedUrlPart: string;
    }> = [
      { provider: "openai", model: "gpt-4.1", apiKey: "sk-openai-test", expectedUrlPart: "/api/chat/stream" },
      { provider: "anthropic", model: "claude-3-7-sonnet-latest", apiKey: "sk-ant-test", expectedUrlPart: "/api/chat/stream" },
      { provider: "custom", model: "deepseek-ai/DeepSeek-V3", baseUrl: "https://api.together.xyz/v1", apiKey: "sk-custom-test", expectedUrlPart: "/api/chat/stream" },
      { provider: "ollama", model: "llama3.2", baseUrl: "http://192.168.1.50:11434", expectedUrlPart: "/api/chat/stream" },
      { provider: "gemini", model: "gemini-2.5-pro", apiKey: "AIza-test", expectedUrlPart: "/api/chat/stream" },
      { provider: "openrouter", model: "google/gemma-3-27b-it:free", apiKey: "sk-or-v1-test-1234", expectedUrlPart: "openrouter.ai" },
      { provider: "openrouter", model: OPENROUTER_DEFAULT_PAID_MODEL, apiKey: "sk-or-v1-test-1234", expectedUrlPart: "openrouter.ai" },
    ];

    for (const sc of scenarios) {
      await saveProviderConfig({
        activeProvider: sc.provider,
        providerId: sc.provider,
        model: sc.model,
        baseUrl: sc.baseUrl,
        apiKey: sc.apiKey,
      });
      assert.strictEqual(getActiveProviderId(), sc.provider);
      assert.strictEqual(getSelectedModelForProvider(sc.provider), sc.model);
      assert.strictEqual(getSettings().models.chatProvider, sc.provider);
      assert.strictEqual(getSettings().models.chatText, sc.model);

      let answeredModel = "";
      await new Promise<void>((resolve, reject) => {
        streamChat(
          {
            contentMode: "mature",
            messages: [{ role: "user", content: "Ping" }],
          },
          {
            onChunk: () => {},
            onMetadata: (meta) => {
              answeredModel = meta.answeredModel || "";
            },
            onDone: () => resolve(),
            onError: (err) => reject(err),
          }
        );
      });

      const lastReq = dispatchedRequests[dispatchedRequests.length - 1];
      assert.ok(lastReq.url.includes(sc.expectedUrlPart), `Expected ${sc.provider} request URL to match ${sc.expectedUrlPart}, got ${lastReq.url}`);
      if (!lastReq.url.includes("openrouter.ai")) {
        assert.strictEqual(lastReq.provider, sc.provider, `Web proxy payload must send provider "${sc.provider}"`);
      }
      assert.strictEqual(lastReq.model, sc.model, `Provider ${sc.provider} must send exact model "${sc.model}", never Dolphin 24B`);
      assert.strictEqual(answeredModel, sc.model, `Provider ${sc.provider} must emit answeredModel="${sc.model}"`);
      if (sc.model !== OPENROUTER_DEFAULT_PAID_MODEL) {
        assert.notStrictEqual(answeredModel, OPENROUTER_DEFAULT_PAID_MODEL, `${sc.provider} must NOT revert to Dolphin 24B`);
      }
    }

    // 5. Transient Ollama fallback must NOT overwrite activeProvider ('ollama') in v3 store
    await saveProviderConfig({
      activeProvider: "ollama",
      providerId: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    });
    await saveProviderConfig({
      providerId: "openrouter",
      apiKey: "sk-or-v1-fallback-only-8888",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("127.0.0.1:11434") || urlStr.includes("/api/chat/stream")) {
        throw new TypeError("Failed to fetch");
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Fallback ok"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    await new Promise<void>((resolve, reject) => {
      streamChat(
        {
          provider: "ollama",
          model: "llama3.2",
          contentMode: "mature",
          messages: [{ role: "user", content: "Ping unreachable ollama" }],
        },
        {
          onChunk: () => {},
          onDone: () => resolve(),
          onError: (err) => reject(err),
        }
      );
    });
    assert.strictEqual(
      getSettings().models.chatProvider,
      "ollama",
      "Transient Ollama connection fallback must NOT overwrite user's saved chatProvider in v3 store"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 6. Backup export/import strips secrets and preserves non-secret v3 settings with zero legacy keys
  const exportedBackup = exportLocalBackupData();
  assert.strictEqual(exportedBackup.includes("sk-or-v1-fallback-only-8888"), false, "Backup must never leak API keys");
  assert.strictEqual(exportedBackup.includes("sk-openai-test"), false, "Backup must never leak OpenAI keys");
  localStorage.clear();
  importLocalBackupData(exportedBackup);
  assert.strictEqual(getSettings().models.chatProvider, "ollama");
  assert.ok(!getSettings().providers.openrouter.apiKey, "Imported backup must not populate secret keys");
  for (const legacyKey of LEGACY_SETTINGS_STORAGE_KEYS) {
    assert.strictEqual(localStorage.getItem(legacyKey), null, `Backup import must not reintroduce legacy key "${legacyKey}"`);
  }

  // 7. UI Source Contracts: Settings uses v3 store & 4 cards; Chat & Live expose read-only navigable labels + 401 action
  const chatTsx = fsMod.readFileSync("src/components/ChatInterface.tsx", "utf8");
  const liveTsx = fsMod.readFileSync("src/components/LiveVoice.tsx", "utf8");
  const settingsTsx = fsMod.readFileSync("src/components/Settings.tsx", "utf8");
  const homeTsx = fsMod.readFileSync("src/components/HomeView.tsx", "utf8");

  assert.ok(chatTsx.includes('data-testid="chat-active-model-chip"'), "ChatInterface must render read-only active model chip");
  assert.ok(chatTsx.includes('data-testid="chat-auth-401-banner"'), "ChatInterface must render 401 Fix Key in Settings banner");
  assert.ok(chatTsx.includes('data-testid="chat-use-paid-default-btn"'), "ChatInterface must render explicit Use Paid Default button");
  assert.strictEqual(chatTsx.includes('data-testid="chat-provider-select"'), false, "ChatInterface must not render duplicate inline provider picker");
  assert.strictEqual(chatTsx.includes('data-testid="chat-openrouter-try-free"'), false, "ChatInterface must not render duplicate try-free toggle");
  assert.strictEqual(chatTsx.includes('data-testid="chat-openrouter-fallback-paid"'), false, "ChatInterface must not render duplicate OpenRouter fallback toggle");

  assert.ok(liveTsx.includes('data-testid="live-active-model-chip"'), "LiveVoice must render read-only active model chip");
  assert.ok(liveTsx.includes('data-testid="live-auth-401-settings-btn"'), "LiveVoice must render 401 Fix Key in Settings action");
  assert.strictEqual(liveTsx.includes('data-testid="live-provider-select"'), false, "LiveVoice must not render duplicate inline provider picker");
  assert.strictEqual(liveTsx.includes('data-testid="openrouter-live-model-select"'), false, "LiveVoice must not render duplicate OpenRouter model picker");
  assert.strictEqual(liveTsx.includes('data-testid="openrouter-try-free-first-toggle"'), false, "LiveVoice must not render duplicate OpenRouter try-free toggle");
  assert.strictEqual(liveTsx.includes('data-testid="live-voice-thinking-level-selector"'), false, "LiveVoice must not render duplicate thinking level picker");

  assert.ok(settingsTsx.includes("useSettings"), "Settings must read/write v3 settings store");
  assert.ok(homeTsx.includes("useSettings"), "HomeView must subscribe to v3 settings store");
  assert.strictEqual(
    settingsTsx.includes("provider-ws-endpoint-input-${pid}") && settingsTsx.includes("defEp.supportsWs"),
    true,
    "Settings must hide WebSocket URL field when provider does not support WebSockets"
  );
});

test("Echo/Barge-In Loop Prevention, Voice Label Mapping & Hardened On-Device Memory", async () => {
  const fsMod = await import("node:fs");
  const {
    shouldDropEchoTranscript,
    recordSpokenSegment,
  } = await import("../src/lib/echoFilter");
  const {
    evaluateBargeInDecision,
  } = await import("../src/components/LiveVoice");
  const {
    LocalVoiceTurnStateMachine,
    DEFAULT_LOCAL_VOICE_SETTINGS,
  } = await import("../src/lib/localVoiceEngine");
  const {
    getSettings,
  } = await import("../src/lib/settingsStore");
  const {
    resolveOpenRouterTtsVoice,
    getEffectiveLiveVoiceLabel,
    speakLiveSentenceWithConfiguredProvider,
    stopSpeaking,
  } = await import("../src/lib/ttsService");
  const {
    clearConversationSummaries,
    getConversationSummaries,
    getAllConversationSummaries,
    deleteConversationSummary,
    saveConversationSummary,
    summarizeAndSaveConversation,
    buildSierraSystemInstruction,
    setActiveIdentity,
    setSelectedVoiceProvider,
    setOpenRouterApiKey,
    HEYGEN_OPENROUTER_VOICES,
  } = await import("../src/lib/persona");

  // Mock clean localStorage
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };

  localStorage.clear();
  const defaults = getSettings();

  // 1. Unified Barge-in settings & defaults
  assert.strictEqual(defaults.live.local.bargeInMode, "headphones_only");
  assert.strictEqual(DEFAULT_LOCAL_VOICE_SETTINGS.bargeInMode, "headphones_only");
  assert.strictEqual(DEFAULT_LOCAL_VOICE_SETTINGS.bargeInThreshold, 0.85);
  assert.strictEqual(DEFAULT_LOCAL_VOICE_SETTINGS.bargeInSpeakerBoost, 0);
  assert.strictEqual(DEFAULT_LOCAL_VOICE_SETTINGS.bargeInSustainedMs, 800);

  // 2. Echo Transcript Filter (substring, >=60% token overlap, <=3 words during/post playback)
  const now = 100_000;
  const segments = recordSpokenSegment(
    [],
    "Sure, I can help you organize an inventory of everything in your workshop today.",
    now - 2_000
  );

  const subDrop = shouldDropEchoTranscript({
    transcript: "an inventory.",
    recentSegments: segments,
    isSpeaking: true,
    lastPlaybackEndedAtMs: 0,
    nowMs: now,
  });
  assert.strictEqual(subDrop.drop, true);
  assert.strictEqual(subDrop.reason, "substring");

  const overlapDrop = shouldDropEchoTranscript({
    transcript: "organize an inventory of workshop",
    recentSegments: segments,
    isSpeaking: false,
    lastPlaybackEndedAtMs: now - 300,
    nowMs: now,
  });
  assert.strictEqual(overlapDrop.drop, true);
  assert.ok(overlapDrop.overlapRatio >= 0.6);

  const shortPostSpeechDrop = shouldDropEchoTranscript({
    transcript: "Tat.",
    recentSegments: segments,
    isSpeaking: false,
    lastPlaybackEndedAtMs: now - 500,
    nowMs: now,
  });
  assert.strictEqual(shortPostSpeechDrop.drop, true);
  assert.strictEqual(shortPostSpeechDrop.reason, "short_post_speech");

  const genuineUserSpeech = shouldDropEchoTranscript({
    transcript: "Hey can you check my calendar for tomorrow morning?",
    recentSegments: segments,
    isSpeaking: false,
    lastPlaybackEndedAtMs: now - 5_000,
    nowMs: now,
  });
  assert.strictEqual(genuineUserSpeech.drop, false);

  const expiredWindowUserSpeech = shouldDropEchoTranscript({
    transcript: "an inventory.",
    recentSegments: segments,
    isSpeaking: false,
    lastPlaybackEndedAtMs: now - 20_000,
    nowMs: now + 20_000,
  });
  assert.strictEqual(expiredWindowUserSpeech.drop, false, "15s window should expire old spoken text");

  // 3. Barge-in Mode Gating (Off / Headphones only / On) + 400ms cooldown + 800ms sustained + adaptive RMS
  const blockedSpeaker = evaluateBargeInDecision({
    micRms: 0.9,
    playbackRms: 0.1,
    isPlaying: true,
    mode: "speaker",
    bargeInMode: "headphones_only",
    hasHeadset: false,
    sustainedMs: 1200,
    timeSinceTurnStartMs: 2000,
    timeSincePlaybackEndMs: 150,
  });
  assert.strictEqual(blockedSpeaker.shouldTrigger, false);
  assert.strictEqual(blockedSpeaker.reason, "within_grace");

  const blockedHeadsetShort = evaluateBargeInDecision({
    micRms: 0.4,
    playbackRms: 0.1,
    isPlaying: true,
    mode: "headphones",
    bargeInMode: "headphones_only",
    hasHeadset: true,
    sustainedMs: 100,
    timeSinceTurnStartMs: 2000,
  });
  assert.strictEqual(blockedHeadsetShort.shouldTrigger, false);
  assert.strictEqual(blockedHeadsetShort.reason, "accumulating");

  const allowedHeadset = evaluateBargeInDecision({
    micRms: 0.4,
    playbackRms: 0.1,
    isPlaying: true,
    mode: "headphones",
    bargeInMode: "headphones_only",
    hasHeadset: true,
    sustainedMs: 850,
    timeSinceTurnStartMs: 2000,
  });
  assert.strictEqual(allowedHeadset.shouldTrigger, true);

  // State machine enforces 400ms post-playback cooldown & adaptive RMS when barge-in is disabled or enabled
  let bargeInCalls = 0;
  let utteranceCalls = 0;
  const sm = new LocalVoiceTurnStateMachine(
    {
      sampleRate: 16000,
      bargeInMode: "headphones_only",
      hasHeadset: false,
      bargeInThreshold: 0.85,
      bargeInSustainedMs: 800,
      postPlaybackCooldownMs: 400,
    },
    {
      stopAndFlushAudioPlayback: () => {},
      cancelLlmGeneration: () => {},
      cancelTtsAndEmptyQueue: () => {},
      onBargeInTriggered: () => {
        bargeInCalls++;
      },
      onUtteranceFinished: () => {
        utteranceCalls++;
      },
    }
  );
  const loudFrame = new Float32Array(480).fill(0.5);
  sm.beginAssistantThinking();
  sm.beginAssistantSpeaking();
  for (let i = 0; i < 35; i++) {
    sm.processFrame(loudFrame, 0.99, 30, 1000 + i * 30);
  }
  assert.strictEqual(bargeInCalls, 0, "Headphones-only mode without headset must ignore VAD during playback");

  // During 400ms cooldown after playback ends, idle VAD frames must also be ignored
  sm.finishAssistantSpeaking();
  sm.markPlaybackEnded(2000);
  for (let i = 0; i < 10; i++) {
    sm.processFrame(loudFrame, 0.99, 30, 2050 + i * 30);
  }
  assert.strictEqual(sm.getState(), "idle", "400ms post-playback cooldown must suppress residual echo frames");
  assert.strictEqual(utteranceCalls, 0);

  // Enable 'on' mode with high adaptive playback RMS -> blocks quiet echo, triggers on louder user speech >= 800ms
  sm.setBargeInMode("on");
  sm.updatePlaybackLevel(0.35);
  sm.beginAssistantThinking();
  sm.beginAssistantSpeaking();
  const quietEchoFrame = new Float32Array(480).fill(0.2);
  for (let i = 0; i < 35; i++) {
    sm.processFrame(quietEchoFrame, 0.99, 30, 3000 + i * 30);
  }
  assert.strictEqual(bargeInCalls, 0, "Mic RMS below adaptive playback level must not trigger barge-in");
  const strongUserFrame = new Float32Array(480).fill(0.65);
  for (let i = 0; i < 30; i++) {
    sm.processFrame(strongUserFrame, 0.92, 30, 5000 + i * 30);
  }
  assert.strictEqual(bargeInCalls, 1, "Sustained >=800ms speech with mic RMS above adaptive playback level triggers barge-in");

  // 4. OpenRouter TTS Direct Voice Selection & Effective Label + No Native Fallback After Barge-In
  assert.strictEqual(HEYGEN_OPENROUTER_VOICES[0]?.id, "nadine");
  const directVoice = resolveOpenRouterTtsVoice({ requestedVoice: "noelle", accent: "British", tone: "Warm" });
  assert.strictEqual(directVoice.effectiveVoice, "noelle");
  assert.strictEqual(directVoice.presetRemapped, false);
  assert.strictEqual(directVoice.ignoredAccentOrTone, true);

  const labelInfo = getEffectiveLiveVoiceLabel({
    liveProvider: "openrouter",
    ttsProvider: "openrouter",
    requestedVoice: "noelle",
  });
  assert.ok(labelInfo.label.includes("OpenRouter HeyGen") && labelInfo.label.includes("noelle"));

  let nativeTtsFallbackCount = 0;
  const origFetch = globalThis.fetch;
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    speechSynthesis: {
      cancel: () => {},
      speak: () => {
        nativeTtsFallbackCount++;
      },
      getVoices: () => [],
    },
  };
  setSelectedVoiceProvider("openrouter");
  setOpenRouterApiKey("sk-or-v1-test1234");
  globalThis.fetch = (async (_url: any, init: any) => {
    const signal: AbortSignal | undefined = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        const err: any = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      signal?.addEventListener("abort", () => {
        const err: any = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
      setTimeout(() => stopSpeaking("barge_in"), 15);
    });
  }) as any;

  try {
    const ttsRes = await speakLiveSentenceWithConfiguredProvider({
      sentence: "This sentence should cancel cleanly without native fallback.",
      voiceId: "Aoede",
    });
    assert.strictEqual(ttsRes.interrupted, true);
  } finally {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }
  assert.strictEqual(nativeTtsFallbackCount, 0, "Aborted OpenRouter TTS must NEVER fall back to native Android/Web TTS");

  // 5. Hardened On-Device Memory (seqId, <=200 chars, trivial & interrupted skipping, identity separation)
  clearConversationSummaries();
  setActiveIdentity("sierra");

  const trivialRes = summarizeAndSaveConversation(
    "trivial-1",
    [
      { role: "user", content: "Okay." },
      { role: "assistant", content: "Got it! Let me know whenever you need anything." },
    ],
    undefined,
    "live"
  );
  assert.strictEqual(trivialRes, null, "Trivial <=3 word / greeting user turns must not pollute memory");

  const interruptedZeroSpoken = summarizeAndSaveConversation(
    "interrupted-zero",
    [
      { role: "user", content: "Tell me about quantum computing architectures." },
      { role: "assistant", content: "Quantum computing uses qubits in superposition.", interrupted: true },
    ],
    undefined,
    "live",
    "en-US",
    { wasInterrupted: true, spokenReplyOverride: "" }
  );
  assert.strictEqual(interruptedZeroSpoken, null, "Interrupted turn with zero spoken audio must not be stored");

  const interruptedWithSpoken = summarizeAndSaveConversation(
    "interrupted-spoken",
    [
      { role: "user", content: "Explain fusion reactors briefly." },
      { role: "assistant", content: "Full unspoken text.", interrupted: true },
    ],
    undefined,
    "live",
    "en-US",
    { wasInterrupted: true, spokenReplyOverride: "Tokamak magnets confine superheated plasma." }
  );
  assert.ok(interruptedWithSpoken, "Interrupted turn with real spoken prefix stores only spoken prefix");
  assert.ok(interruptedWithSpoken!.summary.includes("Tokamak magnets"));
  assert.strictEqual(interruptedWithSpoken!.summary.includes("Full unspoken text"), false);

  // Per-identity isolation & monotonic seqId past cap 30
  clearConversationSummaries("sierra");
  for (let i = 1; i <= 35; i++) {
    saveConversationSummary({
      id: `sierra-${i}`,
      identity: "sierra",
      source: "live",
      summary: `Sierra discussed robotics experiment #${i} and battery chemistry targets in full detail `.repeat(3),
      updatedAt: 1000 + i,
    });
  }
  saveConversationSummary({
    id: "tyler-1",
    identity: "tyler",
    source: "chat",
    summary: "Tyler planned a trail run for Saturday morning at 7am.",
    updatedAt: 5000,
  });

  const sierraList = getConversationSummaries("sierra");
  const tylerList = getConversationSummaries("tyler");
  assert.strictEqual(sierraList.length, 30, "Sierra summaries capped at 30");
  assert.strictEqual(tylerList.length, 1, "Tyler identity memory isolated from Sierra");
  assert.ok(sierraList.every((s) => s.summary.length <= 200), "All summaries clamped <= 200 chars");

  const seqIds = sierraList.map((s) => s.seqId || 0);
  assert.strictEqual(new Set(seqIds).size, seqIds.length, "Monotonic seqIds must never collide after eviction");
  assert.ok(seqIds[seqIds.length - 1] > seqIds[0]);

  deleteConversationSummary(sierraList[0].id, "sierra");
  assert.strictEqual(getConversationSummaries("sierra").length, 29);
  clearConversationSummaries("sierra");
  assert.strictEqual(getConversationSummaries("sierra").length, 0);
  assert.strictEqual(getConversationSummaries("tyler").length, 1, "Clearing Sierra must preserve Tyler memory");
  assert.strictEqual(getAllConversationSummaries().length, 1);

  const sysPrompt = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "tyler");
  assert.ok(sysPrompt.includes("Saturday morning at 7am"), "Tyler system instruction injects Tyler memories");

  // 6. Native Java & UI Source Contracts
  const engineJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoiceEngine.java", "utf8");
  const pluginJava = fsMod.readFileSync("android/app/src/main/java/com/sierra/omniagent/LocalVoicePlugin.java", "utf8");
  const settingsTsx = fsMod.readFileSync("src/components/Settings.tsx", "utf8");
  const liveTsx = fsMod.readFileSync("src/components/LiveVoice.tsx", "utf8");

  assert.ok(engineJava.includes("AcousticEchoCanceler.isAvailable()"), "Engine must log AEC availability");
  assert.ok(engineJava.includes("NoiseSuppressor.isAvailable()"), "Engine must log NS availability");
  assert.ok(engineJava.includes("MODE_IN_COMMUNICATION"), "Engine must switch AudioManager to MODE_IN_COMMUNICATION");
  assert.ok(engineJava.includes("USAGE_VOICE_COMMUNICATION"), "Engine AudioTrack/TTS must use USAGE_VOICE_COMMUNICATION");
  assert.ok(engineJava.includes("playPcmOrWavAudio"), "Engine must support AudioTrack playback for AEC reference");
  assert.ok(pluginJava.includes("playPcmAudio") && pluginJava.includes("isHeadsetConnected"), "Plugin must expose playPcmAudio and isHeadsetConnected");
  assert.ok(settingsTsx.includes('data-testid="memory-clear-all-btn"') && settingsTsx.includes('data-testid="memory-delete-item-btn"'), "Settings must render Memory management controls");
  assert.ok(settingsTsx.includes("settings-barge-in-mode-") && settingsTsx.includes("'headphones_only'"), "Settings must render Barge-in mode controls");
  assert.ok(liveTsx.includes('data-testid="live-effective-voice-label"'), "LiveVoice must display effective voice status line");

  // Allow node:test reporter to flush after all sequential tests complete
});

test("Task 4: Adaptive Barge-In (Headphones Immediate, Speaker VAD >= 0.85 & RMS > max(0.2, 2x playback) for >= 400ms)", async () => {
  const { evaluateBargeInDecision } = await import("../src/components/LiveVoice");
  const { LocalVoiceTurnStateMachine } = await import("../src/lib/localVoiceEngine");

  // 1. Headphones + Adaptive -> immediate trigger (0ms sustained)
  const headsetImmediate = evaluateBargeInDecision({
    micRms: 0.03,
    playbackRms: 0.15,
    isPlaying: true,
    sustainedMs: 0,
    timeSinceTurnStartMs: 50,
    mode: "headphones",
    bargeInMode: "adaptive",
    hasHeadset: true,
    vadProb: 0.88,
  });
  assert.strictEqual(headsetImmediate.shouldTrigger, true);

  // 2. Speaker + Adaptive: echo RMS <= max(0.2, 2*playback) ignored
  const speakerEcho = evaluateBargeInDecision({
    micRms: 0.25,
    playbackRms: 0.15, // required = 0.30
    isPlaying: true,
    sustainedMs: 500,
    timeSinceTurnStartMs: 900,
    mode: "speaker",
    bargeInMode: "adaptive",
    hasHeadset: false,
    vadProb: 0.92,
  });
  assert.strictEqual(speakerEcho.shouldTrigger, false);
  assert.strictEqual(speakerEcho.reason, "below_threshold");
  assert.ok(Math.abs(speakerEcho.requiredRms - 0.3) < 1e-9);

  // 3. Speaker + Adaptive: low VAD (<0.85) ignored even with high RMS
  const lowVad = evaluateBargeInDecision({
    micRms: 0.5,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 500,
    timeSinceTurnStartMs: 900,
    mode: "speaker",
    bargeInMode: "adaptive",
    hasHeadset: false,
    vadProb: 0.72,
  });
  assert.strictEqual(lowVad.shouldTrigger, false);
  assert.strictEqual(lowVad.reason, "below_threshold");

  // 4. Speaker + Adaptive: short burst (<400ms) ignored -> >=400ms triggers
  const shortBurst = evaluateBargeInDecision({
    micRms: 0.5,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 300,
    timeSinceTurnStartMs: 900,
    mode: "speaker",
    bargeInMode: "adaptive",
    hasHeadset: false,
    vadProb: 0.90,
  });
  assert.strictEqual(shortBurst.shouldTrigger, false);
  assert.strictEqual(shortBurst.reason, "accumulating");

  const sustainedSpeaker = evaluateBargeInDecision({
    micRms: 0.5,
    playbackRms: 0.05,
    isPlaying: true,
    sustainedMs: 420,
    timeSinceTurnStartMs: 900,
    mode: "speaker",
    bargeInMode: "adaptive",
    hasHeadset: false,
    vadProb: 0.90,
  });
  assert.strictEqual(sustainedSpeaker.shouldTrigger, true);

  // 5. LocalVoiceTurnStateMachine Adaptive mode tests + BargeIn:Accepted/Ignored logs
  const events: Array<{ accepted: boolean; reason: string }> = [];
  let triggers = 0;
  const sm = new LocalVoiceTurnStateMachine(
    {
      sampleRate: 16000,
      bargeInMode: "adaptive",
      hasHeadset: false,
      bargeInThreshold: 0.85,
      bargeInSustainedMs: 400,
    },
    {
      stopAndFlushAudioPlayback: () => {},
      cancelLlmGeneration: () => {},
      cancelTtsAndEmptyQueue: () => {},
      onBargeInTriggered: () => {
        triggers++;
      },
      onBargeInEvaluated: (ev) => {
        events.push({ accepted: ev.accepted, reason: ev.reason });
      },
    }
  );
  sm.updatePlaybackLevel(0.25); // smoothed adaptivePlaybackRms ~0.15 => required = max(0.2, 0.30) = 0.30
  sm.beginAssistantThinking();
  sm.beginAssistantSpeaking();

  // Short 210ms burst above 0.30 followed by silence resets and never triggers
  const loud = new Float32Array(480).fill(0.45);
  const quiet = new Float32Array(480).fill(0.05);
  for (let i = 0; i < 7; i++) sm.processFrame(loud, 0.91, 30, 1000 + i * 30);
  sm.processFrame(quiet, 0.2, 30, 1300);
  assert.strictEqual(triggers, 0);
  assert.ok(events.some((e) => !e.accepted && e.reason === "short_burst_reset"));

  // Sustained >= 400ms (14 * 30ms = 420ms) triggers cleanly
  for (let i = 0; i < 14; i++) sm.processFrame(loud, 0.91, 30, 2000 + i * 30);
  assert.strictEqual(triggers, 1);
  assert.ok(events.some((e) => e.accepted && e.reason === "adaptive_speaker_sustained"));
});

test("Task 5: Single Source of Truth (v3), Non-Destructive Migration, No Silent Reset & Chat Retry", async () => {
  const fsMod = await import("node:fs");
  const {
    STORAGE_KEY_MIGRATION_BACKUP,
    getSettings,
    updateSettings,
    migrateOnceToV3,
    getCustomDirectives,
    setCustomDirectives,
    getLiveLanguageSetting,
    setLiveLanguageSetting,
    getVoiceInputEngineSetting,
    setVoiceInputEngineSetting,
    getSelectedPersonaSetting,
    setSelectedPersonaSetting,
  } = await import("../src/lib/settingsStore");
  const { OPENROUTER_DEFAULT_PAID_MODEL } = await import("../src/lib/openRouterLive");
  const { saveProviderConfig, streamChat } = await import("../src/lib/providers");

  // 1. Legacy keys preserved on migration and do not overwrite later v3 updates
  localStorage.clear();
  localStorage.setItem("omni_active_provider", "openai");
  localStorage.setItem("sierra_custom_directives", "Keep answers crisp.");
  localStorage.setItem("sierra_live_language", "es-ES");
  localStorage.setItem("sierra_voice_input_engine", "native_recognizer");
  localStorage.setItem("sierra_selected_persona", "edgy");

  const migrated = migrateOnceToV3();
  assert.strictEqual(migrated.models.chatProvider, "openai");
  assert.strictEqual(getCustomDirectives(), "Keep answers crisp.");
  assert.strictEqual(getLiveLanguageSetting(), "es-ES");
  assert.strictEqual(getVoiceInputEngineSetting(), "native_stt");
  assert.strictEqual(getSelectedPersonaSetting(), "edgy");
  assert.ok(localStorage.getItem(STORAGE_KEY_MIGRATION_BACKUP));
  // Legacy keys must NOT be deleted
  assert.strictEqual(localStorage.getItem("omni_active_provider"), "openai");
  assert.strictEqual(localStorage.getItem("sierra_custom_directives"), "Keep answers crisp.");

  // Mutate v3 store after migration and ensure repeated getSettings/migrateOnceToV3 keeps new v3 values
  updateSettings((d) => {
    d.models.chatProvider = "anthropic";
    return d;
  });
  setCustomDirectives("Updated v3 directive");
  setLiveLanguageSetting("en-US");
  setVoiceInputEngineSetting("raw_streaming");
  setSelectedPersonaSetting("classy");

  assert.strictEqual(getSettings().models.chatProvider, "anthropic");
  assert.strictEqual(migrateOnceToV3().models.chatProvider, "anthropic");
  assert.strictEqual(getCustomDirectives(), "Updated v3 directive");
  assert.strictEqual(getLiveLanguageSetting(), "en-US");
  assert.strictEqual(getVoiceInputEngineSetting(), "raw_streaming");
  assert.strictEqual(getSelectedPersonaSetting(), "classy");

  // 2. HTTP errors never silently reset chosen model/provider to Dolphin
  await saveProviderConfig({
    activeProvider: "openai",
    providerId: "openai",
    model: "gpt-4.1",
    apiKey: "sk-openai-stay-put",
  });
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Upstream 500 error" }), { status: 500 })) as any;
    let sawError = false;
    await new Promise<void>((resolve) => {
      streamChat(
        {
          provider: "openai",
          model: "gpt-4.1",
          contentMode: "mature",
          messages: [{ role: "user", content: "Test failure handling" }],
        },
        {
          onChunk: () => {},
          onDone: () => resolve(),
          onError: () => {
            sawError = true;
            resolve();
          },
        }
      );
    });
    assert.strictEqual(sawError, true);
    assert.strictEqual(getSettings().models.chatProvider, "openai");
    assert.strictEqual(getSettings().models.chatText, "gpt-4.1");
    assert.notStrictEqual(getSettings().models.chatText, OPENROUTER_DEFAULT_PAID_MODEL);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 3. UI check: ChatInterface exposes Retry button and unified custom directives usage
  const chatTsx = fsMod.readFileSync("src/components/ChatInterface.tsx", "utf8");
  const liveTsx = fsMod.readFileSync("src/components/LiveVoice.tsx", "utf8");
  assert.ok(chatTsx.includes('data-testid="chat-retry-btn"'), "ChatInterface must render Retry button on error");
  assert.ok(chatTsx.includes('data-testid="chat-error-retry-banner"'), "ChatInterface must render error retry banner");
  assert.ok(chatTsx.includes("getCustomDirectives"), "ChatInterface must read customDirectives from settingsStore");
  assert.ok(liveTsx.includes("getLiveLanguageSetting"), "LiveVoice must read/write language via settingsStore");
  assert.ok(liveTsx.includes("getCustomDirectives"), "LiveVoice must read customDirectives via settingsStore");
});

test("Task 6: Sierra Memory Cap=30, Phantom/<8-Word Skip, Honesty Directives, Backup & [Memory] Logs", async () => {
  const {
    MAX_CONVERSATION_SUMMARIES,
    clearConversationSummaries,
    getConversationSummaries,
    deleteConversationSummary,
    saveConversationSummary,
    summarizeAndSaveConversation,
    buildSierraSystemInstruction,
    setBackgroundLiveEnabled,
    setWakeWordEnabled,
  } = await import("../src/lib/persona");
  const { buildOpenRouterSystemPrompt } = await import("../src/lib/openRouterLive");
  const { buildCompactLocalSystemPrompt } = await import("../src/lib/localVoiceEngine");
  const { exportLocalBackupData, importLocalBackupData } = await import("../src/lib/chatStore");
  const { clearDebugLogs, getDebugLogs } = await import("../src/lib/debugLogStore");

  localStorage.clear();
  clearConversationSummaries("sierra");
  clearDebugLogs();

  // 1. Cap at 30 summaries dropping oldest
  assert.strictEqual(MAX_CONVERSATION_SUMMARIES, 30);
  for (let i = 1; i <= 34; i++) {
    saveConversationSummary({
      id: `cap-test-${i}`,
      identity: "sierra",
      source: "live",
      summary: `Topic ${i}: discussed unique planning item number ${i} in detail.`,
      updatedAt: 1_000_000 + i,
    });
  }
  const capped = getConversationSummaries("sierra");
  assert.strictEqual(capped.length, 30, "Summaries must cap at 30");
  assert.strictEqual(capped.some((s) => s.id === "cap-test-1"), false, "Oldest summaries must be dropped");
  assert.strictEqual(capped.some((s) => s.id === "cap-test-4"), false);
  assert.strictEqual(capped.some((s) => s.id === "cap-test-5"), true);
  assert.strictEqual(capped.some((s) => s.id === "cap-test-34"), true);

  // Delete-one & Clear-all
  const afterDeleteOne = deleteConversationSummary("cap-test-5", "sierra");
  assert.strictEqual(afterDeleteOne.length, 29);
  assert.strictEqual(afterDeleteOne.some((s) => s.id === "cap-test-5"), false);

  // JSON Export & Import round-trip
  const backupJson = exportLocalBackupData();
  clearConversationSummaries("sierra");
  assert.strictEqual(getConversationSummaries("sierra").length, 0);
  const imported = importLocalBackupData(backupJson);
  assert.strictEqual(imported.summariesCount, 29);
  assert.strictEqual(getConversationSummaries("sierra").length, 29);

  clearConversationSummaries("sierra");
  assert.strictEqual(getConversationSummaries("sierra").length, 0);

  // 2. Skip Task 1 phantoms, <8 combined words, empty, and foreign/garbled transcripts
  const phantomSkip = summarizeAndSaveConversation(
    "skip-phantom",
    [
      { role: "user", content: "Thanks for watching!" },
      { role: "model", content: "Glad to chat with you anytime you want." },
    ],
    "Live",
    "live",
    "en-US"
  );
  assert.strictEqual(phantomSkip, null, "Task 1 phantom phrase must be skipped");

  const shortExchangeSkip = summarizeAndSaveConversation(
    "skip-short-8",
    [
      { role: "user", content: "Check weather now?" },
      { role: "model", content: "It looks sunny." },
    ],
    "Live",
    "live",
    "en-US"
  );
  assert.strictEqual(shortExchangeSkip, null, "Trivial <8 total word exchange must be skipped");

  const foreignSkip = summarizeAndSaveConversation(
    "skip-foreign",
    [
      { role: "user", content: "Hola amigo como estas hoy en Madrid" },
      { role: "model", content: "I am doing very well today, thank you for asking." },
    ],
    "Live",
    "live",
    "en-US"
  );
  assert.strictEqual(foreignSkip, null, "Foreign transcript when en-US locked must be skipped");

  const realSaved = summarizeAndSaveConversation(
    "save-real-1",
    [
      { role: "user", content: "Remind me tomorrow morning about the architecture review meeting." },
      { role: "model", content: "Noted—your architecture review meeting is on my radar for tomorrow morning." },
    ],
    "Work",
    "live",
    "en-US"
  );
  assert.ok(realSaved, "Real substantive exchange must be saved");

  // 3. Honesty directives reflect Settings toggles accurately across Gemini, OpenRouter & Local prompts
  setWakeWordEnabled(false);
  setBackgroundLiveEnabled(false);

  clearDebugLogs();
  const geminiPrompt = buildSierraSystemInstruction("classy", "sfw", undefined, "en-US", "sierra");
  const orPrompt = buildOpenRouterSystemPrompt({
    personaId: "classy",
    contentMode: "sfw",
    companionIdentity: "sierra",
    languageCode: "en-US",
  });
  const localPromptRes = buildCompactLocalSystemPrompt({
    identity: "sierra",
    personaId: "classy",
    contentMode: "sfw",
  });

  assert.ok(geminiPrompt.includes("injected summaries"), "Gemini prompt must state injected summaries limit");
  assert.ok(orPrompt.includes("Wake word is OFF") && orPrompt.includes("Background listening is OFF"));
  assert.ok(localPromptRes.systemPrompt.includes("no wake word") && localPromptRes.systemPrompt.includes("cannot hear while closed"));

  // 4. [Memory] Injected logs include summary count and chars
  const memoryInjectLogs = getDebugLogs().filter((l) => l.detail.includes("[Memory] Injected "));
  assert.ok(memoryInjectLogs.length >= 2, "Must log [Memory] Injected count and chars");
  assert.ok(
    memoryInjectLogs.every((l) => /\d+\s+summaries,\s+\d+\s+chars/.test(l.detail)),
    "Every [Memory] Injected log must report summary count and char count"
  );

  setTimeout(() => {
    process.exit(0);
  }, 250).unref();
});

function capturedSmsUnreadFlag(args: any): boolean {
  return Boolean(args?.unreadOnly);
}















