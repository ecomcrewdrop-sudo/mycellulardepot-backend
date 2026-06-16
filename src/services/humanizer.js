class Humanizer {
  getTypingDelay(message) {
    const words = message.split(/\s+/).length;
    const wpm = 35 + Math.random() * 25;
    const baseMs = (words / wpm) * 60 * 1000;
    const varied = baseMs * (0.75 + Math.random() * 0.5);
    const min = 1800;
    const max = words > 40 ? 14000 : 8000;
    return Math.max(min, Math.min(max, Math.round(varied)));
  }

  getReadingDelay(incomingMessage) {
    const words = (incomingMessage || '').split(/\s+/).length;
    const readWpm = 180 + Math.random() * 120;
    const baseMs = (words / readWpm) * 60 * 1000;
    return Math.max(600, Math.min(3000, Math.round(baseMs)));
  }

  getThinkingPause() {
    const roll = Math.random();
    if (roll < 0.2) return 0;
    if (roll < 0.6) return 800 + Math.random() * 1500;
    return 1500 + Math.random() * 3000;
  }

  shouldSplitMessage(text) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.length > 3 && text.length > 300;
  }

  splitIntoNaturalChunks(text) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 2) return [text];

    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      if (current && (current + ' ' + sentence).length > 200) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  getBetweenChunksDelay() {
    return 1200 + Math.random() * 2000;
  }
}

module.exports = Humanizer;
