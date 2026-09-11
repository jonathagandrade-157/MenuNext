/**
 * Alerta sonoro de novo pedido — gerado via Web Audio API (dois beeps
 * curtos), sem depender de nenhum arquivo de áudio externo. Navegadores
 * bloqueiam autoplay de áudio até o usuário interagir com a página; como o
 * Kanban já exige o lojista logado navegando/clicando na página, isso
 * normalmente já é satisfeito, mas o try/catch garante que um bloqueio de
 * autoplay nunca quebra a aplicação — o alerta simplesmente não toca, e o
 * destaque visual do card novo continua funcionando de qualquer forma.
 */
export function playNewOrderChime(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const beep = (startOffset: number, frequency: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startOffset + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + startOffset);
      oscillator.stop(ctx.currentTime + startOffset + 0.2);
    };

    beep(0, 880);
    beep(0.22, 1108);

    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch {
    // Autoplay bloqueado ou Web Audio indisponível — o card novo ainda fica
    // destacado visualmente, então a falta de som não é crítica.
  }
}
