class VoiceRecorder {
  constructor(onTranscript, onStateChange) {
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
    this.recognition = null;
    this.recording = false;
    this.finalTranscript = '';
    this._init();
  }

  _init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.supported = false; return; }
    this.supported = true;
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this.finalTranscript += t + ' ';
        else interim = t;
      }
      this.onTranscript(this.finalTranscript + interim);
    };

    this.recognition.onerror = (e) => {
      if (e.error !== 'no-speech') {
        this.stop();
        this.onStateChange('error', 'Microphone error: ' + e.error);
      }
    };

    this.recognition.onend = () => {
      if (this.recording) this.recognition.start();
    };
  }

  start(existingText = '') {
    if (!this.supported) {
      this.onStateChange('error', 'Voice not supported on this browser. Type instead.');
      return;
    }
    this.finalTranscript = existingText ? existingText + ' ' : '';
    this.recording = true;
    this.recognition.start();
    this.onStateChange('recording');
  }

  stop() {
    this.recording = false;
    if (this.recognition) this.recognition.stop();
    this.onStateChange('idle');
  }

  toggle(existingText = '') {
    this.recording ? this.stop() : this.start(existingText);
  }
}
