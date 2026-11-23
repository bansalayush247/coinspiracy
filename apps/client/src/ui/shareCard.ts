// A 1200×630 share card for a finished match, drawn on a canvas and shared as an image.
// It names no other player and carries no room code: only your side, your role and the result.

export interface ShareInfo {
  readonly won: boolean;
  readonly winner: 'honest' | 'byzantine';
  readonly role: 'honest' | 'byzantine' | undefined;
  readonly reason: string;
}

const W = 1200;
const H = 630;

export function drawShareCard(info: ShareInfo): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (c === null) return canvas;
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#6a62b0');
  sky.addColorStop(0.45, '#d9849a');
  sky.addColorStop(0.8, '#ffae7e');
  sky.addColorStop(1, '#ffd59a');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // A floating island with the citadel seal, bottom right.
  c.fillStyle = '#8e5e72';
  c.beginPath();
  c.moveTo(820, 470);
  c.lineTo(1120, 470);
  c.lineTo(1040, 560);
  c.lineTo(980, 610);
  c.lineTo(900, 560);
  c.closePath();
  c.fill();
  c.fillStyle = '#f0d7b0';
  c.beginPath();
  c.ellipse(970, 470, 150, 34, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#d6a03c';
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(970, 470, 70, 15, 0, 0, Math.PI * 2);
  c.stroke();
  // Guardians on the island, the winning colour in front.
  const robe = (x: number, color: string): void => {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x - 16, 470);
    c.lineTo(x - 10, 420);
    c.lineTo(x, 400);
    c.lineTo(x + 10, 420);
    c.lineTo(x + 16, 470);
    c.closePath();
    c.fill();
    c.fillStyle = '#2a2238';
    c.beginPath();
    c.ellipse(x, 425, 7, 8, 0, 0, Math.PI * 2);
    c.fill();
  };
  robe(915, '#a983ff');
  robe(1025, '#5fd3b0');
  robe(970, info.winner === 'honest' ? '#5fa8ff' : '#ff8a9a');
  // Text panel.
  c.fillStyle = 'rgba(34, 22, 48, 0.86)';
  c.beginPath();
  c.roundRect(60, 70, 700, 470, 28);
  c.fill();
  c.fillStyle = '#ffd27a';
  c.font = '700 26px system-ui, sans-serif';
  c.fillText('BYZANTINE COUNCIL', 100, 130);
  c.fillStyle = '#fff1de';
  c.font = '800 64px system-ui, sans-serif';
  c.fillText(info.winner === 'honest' ? 'Honest guardians' : 'Byzantine guardians', 100, 215);
  c.fillText('win!', 100, 290);
  c.fillStyle = info.won ? '#5fd3b0' : '#ff9a6a';
  c.font = '700 34px system-ui, sans-serif';
  const who = info.role === undefined ? 'I watched the federation' : `I played ${info.role === 'byzantine' ? 'a Byzantine' : 'an honest'} guardian`;
  c.fillText(`${who}${info.role === undefined ? '' : info.won ? ' and won.' : ' and lost.'}`, 100, 360);
  c.fillStyle = '#e2cfd6';
  c.font = '400 26px system-ui, sans-serif';
  wrap(c, info.reason, 100, 410, 620, 34);
  c.fillStyle = '#ffd27a';
  c.font = '600 24px system-ui, sans-serif';
  c.fillText('A free social-deduction game about federated ecash', 100, 515);
  return canvas;
}

function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number): void {
  let row = '';
  let yy = y;
  for (const word of text.split(' ')) {
    const next = row === '' ? word : `${row} ${word}`;
    if (c.measureText(next).width > max && row !== '') {
      c.fillText(row, x, yy);
      row = word;
      yy += line;
    } else row = next;
  }
  if (row !== '') c.fillText(row, x, yy);
}

// Shares through the system sheet where it accepts files, otherwise saves the image.
export async function shareResult(info: ShareInfo): Promise<'shared' | 'saved' | 'failed'> {
  const canvas = drawShareCard(info);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (blob === null) return 'failed';
  const file = new File([blob], 'byzantine-council.png', { type: 'image/png' });
  const text = info.winner === 'honest' ? 'The honest guardians held the mint in Byzantine Council.' : 'The Byzantines slipped one past the council in Byzantine Council.';
  try {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, url: window.location.origin });
      return 'shared';
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'failed';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'byzantine-council.png';
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return 'saved';
}
