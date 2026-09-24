// Exercise actual hook callbacks with fake media/transport, never a microphone or paid API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, AbortController, AbortSignal,
    require(name) { assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, ...globals });
  return exports;
}
const content = load('lib/kiosk-assistant-content.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const json = value => ({ ok: true, json: async () => value });

function harness(overrides = {}) {
  const values = [], timers = new Map(), sent = [], requests = [], answers = [], errors = [];
  let index = 0, cleanup, peer, audio, stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const channel = { readyState: 'open', send: text => sent.push(JSON.parse(text)), close() { this.readyState = 'closed'; this.onclose?.(); } };
  const react = {
    useRef(initial) { const i = index++; return values[i] ||= { current: initial }; },
    useState(initial) { const i = index++; if (!(i in values)) values[i] = initial;
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    useCallback: fn => fn, useEffect: fn => { cleanup ||= fn(); },
  };
  class Peer {
    constructor() { peer = this; }
    addTrack() {}
    createDataChannel() { return channel; }
    async createOffer() { return { type: 'offer', sdp: 'test-offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { channel.onopen(); }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  }
  const hook = load('hooks/use-kiosk-realtime-voice.ts', { react, '@/lib/kiosk-assistant-content': content }, {
    navigator: { mediaDevices: { getUserMedia: overrides.getUserMedia || (async () => stream) } },
    RTCPeerConnection: Peer,
    Audio: class { constructor() { audio = this; } async play() {} pause() { this.paused = true; } },
    setTimeout(fn, delay) { timers.set(fn, delay); return fn; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url === '/api/kiosk-assistant/realtime') return json({ value: 'ephemeral-test', delivery: content.assistantVoiceStyles.calm });
      if (url.endsWith('/realtime/calls')) return { ok: true, text: async () => 'test-answer' };
      if (url === '/api/kiosk-assistant/ask') return overrides.ask ? overrides.ask() : json({ answer: '추가 결제를 하지 말고 관리자에게 문의해 주세요.' });
      throw new Error(`Unexpected request ${url}`);
    },
  }).useKioskRealtimeVoice;
  return {
    get voice() { index = 0; return hook({ screen: 'onSiteReservation:payment', onQuestion() {}, onAnswer: value => answers.push(value), onError: value => errors.push(value) }); },
    event: value => channel.onmessage({ data: JSON.stringify(value) }),
    get peer() { return peer; }, get audio() { return audio; }, get stopped() { return stopped; },
    unmount: () => cleanup(), stream, channel, timers, requests, sent, answers, errors,
  };
}

const call = { type: 'function_call', name: 'get_kiosk_guidance', call_id: 'call-1', arguments: JSON.stringify({ topic: 'payment', question: '결제가 안 돼요' }) };
function question(h, id = 'classify-1') {
  h.event({ type: 'input_audio_buffer.speech_started' });
  h.event({ type: 'input_audio_buffer.speech_stopped' });
  h.event({ type: 'response.created', response: { id } });
  h.event({ type: 'response.done', response: { id, status: 'completed', output: [call] } });
}

test('voice obtains scoped guidance, streams captions and releases all resources on close', async () => {
  const h = harness();
  await h.voice.start();
  assert.equal(h.voice.phase, 'listening');
  question(h); await flush();
  const lookup = h.requests.find(r => r.url.endsWith('/ask'));
  assert.deepEqual(JSON.parse(lookup.init.body), { topic: 'payment', question: '결제가 안 돼요', screen: 'onSiteReservation:payment' });
  const speech = h.sent.find(e => e.type === 'response.create').response;
  assert.equal(speech.tool_choice, 'none');
  assert.deepEqual(speech.input, []);
  assert.match(speech.instructions, /빠르되 차분하고 친절/);
  assert.match(speech.instructions, /추가 결제를 하지 말고/);
  h.event({ type: 'response.created', response: { id: 'speech-1' } });
  h.event({ type: 'output_audio_buffer.started' });
  h.event({ type: 'response.output_audio_transcript.delta', response_id: 'speech-1', delta: '추가 결제를 ' });
  h.event({ type: 'response.output_audio_transcript.delta', response_id: 'speech-1', delta: '하지 말고' });
  assert.equal(h.voice.phase, 'speaking');
  assert.equal(h.voice.caption, '추가 결제를 하지 말고');
  h.unmount();
  assert.equal(h.stopped, 1);
  assert.equal(h.peer.connectionState, 'closed');
  assert.equal(h.channel.readyState, 'closed');
  assert.equal(h.audio.paused, true);
  assert.equal(h.timers.size, 0);
  assert.equal(lookup.init.signal.aborted, true);
});

test('closing during microphone permission stops the late stream without connecting', async () => {
  let release;
  const h = harness({ getUserMedia: () => new Promise(resolve => { release = resolve; }) });
  const starting = h.voice.start();
  h.voice.stop(); release(h.stream); await starting;
  assert.equal(h.stopped, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.voice.phase, 'idle');
});

test('barge-in discards a late guidance answer and its captions', async () => {
  let release;
  const h = harness({ ask: () => new Promise(resolve => { release = resolve; }) });
  await h.voice.start(); question(h);
  h.event({ type: 'input_audio_buffer.speech_started' });
  h.event({ type: 'response.output_audio_transcript.delta', response_id: 'classify-1', delta: '오래된 답변' });
  release(json({ answer: '오래된 답변' })); await flush();
  assert.equal(h.sent.filter(e => e.type === 'response.create').length, 0);
  assert(!h.answers.includes('오래된 답변'));
  assert.equal(h.voice.caption, '');
  assert.equal(h.voice.phase, 'listening');
  h.voice.stop();
});

test('disconnect and time limit both release the microphone', async () => {
  for (const reason of ['disconnected', 'timeout']) {
    const h = harness(); await h.voice.start();
    if (reason === 'disconnected') { h.peer.connectionState = reason; h.peer.onconnectionstatechange(); }
    else [...h.timers].find(([, delay]) => delay === 180000)[0]();
    assert.equal(h.stopped, 1);
    assert.equal(h.voice.phase, 'idle');
    assert.equal(h.timers.size, 0);
    assert(h.errors.at(-1));
  }
});

test('server issues only an ephemeral key with requested voice and read-only tools', async () => {
  let session;
  const route = load('app/api/kiosk-assistant/realtime/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, init }) } },
    '@/lib/kiosk-assistant-content': content, '@/lib/kiosk-scope': { getKioskScope: () => ({ property: 'property3', building: 'A' }) },
  }, { process: { env: { OPENAI_API_KEY: 'server-only-test' } }, fetch: async (_, init) => {
    session = JSON.parse(init.body).session;
    return json({ value: 'short-lived-test', session: { private: 'not-for-browser' } });
  } });
  const result = await route.POST();
  assert.equal(result.body.value, 'short-lived-test');
  assert(!JSON.stringify(result).includes('server-only-test'));
  assert(!('session' in result.body));
  assert.equal(session.audio.output.voice, 'marin');
  assert.match(session.instructions, /20대 여성/);
  assert.deepEqual(session.output_modalities, ['text']);
  assert.equal(session.tool_choice, 'required');
  assert.deepEqual(session.tools.map(t => t.name), ['get_kiosk_guidance']);
  assert.equal(session.audio.input.turn_detection.interrupt_response, true);
});
