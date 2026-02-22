export class HandTracker {
  /**
   * @param {{maxNumHands?:number,modelComplexity?:number,minDetectionConfidence?:number,minTrackingConfidence?:number}} opts
   */
  constructor(opts = {}) {
    const HandsCtor = window.Hands;
    if (!HandsCtor) throw new Error("MediaPipe Hands not loaded");

    this.hands = new HandsCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: opts.maxNumHands ?? 1,
      modelComplexity: opts.modelComplexity ?? 0,
      minDetectionConfidence: opts.minDetectionConfidence ?? 0.55,
      minTrackingConfidence: opts.minTrackingConfidence ?? 0.55,
      selfieMode: false,
    });
  }

  /**
   * @param {(results:any)=>void} cb
   */
  onResults(cb) {
    this.hands.onResults(cb);
  }

  /**
   * @param {HTMLVideoElement} videoEl
   */
  async processVideoFrame(videoEl) {
    await this.hands.send({ image: videoEl });
  }
}

