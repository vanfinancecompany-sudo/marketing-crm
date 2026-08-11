const WidgetClass = globalThis.customElements?.get("vfc-ai-assistant");

function recognitionConstructor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

function updateLiveField(widget, text) {
  const input = widget.shadowRoot?.querySelector("#customerMessage");
  if (input) input.value = String(text || "").trim();
  const status = widget.shadowRoot?.querySelector(".voice-status");
  if (status && widget.voiceRecording) {
    status.textContent = text
      ? "Listening… I can hear you. Tap the red microphone when you’ve finished."
      : "Listening… speak now. Tap the red microphone when you’ve finished.";
  }
}

function restoreLiveTranscript(widget, text) {
  const fallback = String(text || "").trim().slice(0, 3000);
  if (!fallback) return false;
  widget.voiceError = "";
  widget.render();
  const input = widget.shadowRoot?.querySelector("#customerMessage");
  if (input) {
    input.value = fallback;
    input.focus();
  }
  const status = widget.shadowRoot?.querySelector(".voice-status");
  if (status) {
    status.textContent = "Voice captured. Please check the text, then press Send.";
    status.classList.remove("error");
  }
  return true;
}

if (WidgetClass && !WidgetClass.prototype.__vfcLiveVoiceFeedbackInstalled) {
  const prototype = WidgetClass.prototype;
  prototype.__vfcLiveVoiceFeedbackInstalled = true;

  const originalStart = prototype.startVoiceRecording;
  const originalFinish = prototype.finishVoiceRecording;
  const originalCancel = prototype.cancelVoiceCapture;

  prototype.stopLiveVoiceRecognition = function stopLiveVoiceRecognition() {
    const recognition = this.voiceRecognition;
    this.voiceRecognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch {}
  };

  prototype.startLiveVoiceRecognition = function startLiveVoiceRecognition() {
    const Recognition = recognitionConstructor();
    this.voiceRecognitionFinal = "";
    this.voiceRecognitionLive = "";
    updateLiveField(this, "");
    if (!Recognition || !this.voiceRecording) return;

    try {
      const recognition = new Recognition();
      recognition.lang = "en-GB";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this.voiceRecognition = recognition;

      recognition.onresult = (event) => {
        let finalText = this.voiceRecognitionFinal || "";
        let interimText = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = String(event.results[index]?.[0]?.transcript || "").trim();
          if (!transcript) continue;
          if (event.results[index].isFinal) finalText = `${finalText} ${transcript}`.trim();
          else interimText = `${interimText} ${transcript}`.trim();
        }
        this.voiceRecognitionFinal = finalText;
        this.voiceRecognitionLive = `${finalText} ${interimText}`.trim().slice(0, 3000);
        updateLiveField(this, this.voiceRecognitionLive);
      };

      recognition.onerror = () => {
        // OpenAI transcription after Stop remains preferred. Live words are also retained as a fallback.
      };
      recognition.onend = () => {
        if (this.voiceRecording && this.voiceRecognition === recognition) {
          try { recognition.start(); } catch {}
        }
      };
      recognition.start();
    } catch {
      this.voiceRecognition = null;
    }
  };

  prototype.startVoiceRecording = async function startVoiceRecordingWithFeedback(...args) {
    await originalStart.apply(this, args);
    if (this.voiceRecording) this.startLiveVoiceRecognition();
  };

  prototype.finishVoiceRecording = async function finishVoiceRecordingWithFeedback(...args) {
    const liveTranscript = String(this.voiceRecognitionLive || this.voiceRecognitionFinal || "").trim();
    this.stopLiveVoiceRecognition();
    await originalFinish.apply(this, args);

    if (this.voiceError && liveTranscript) {
      restoreLiveTranscript(this, liveTranscript);
    }
  };

  prototype.cancelVoiceCapture = function cancelVoiceCaptureWithFeedback(...args) {
    this.stopLiveVoiceRecognition?.();
    return originalCancel.apply(this, args);
  };
}
