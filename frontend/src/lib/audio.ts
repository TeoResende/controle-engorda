/**
 * Gravação da observação em áudio.
 *
 * Opus/WebM porque o áudio pode passar dias na fila do celular: um dia de
 * curral em codec pesado enche o armazenamento do aparelho. O limite de duração
 * existe pelo mesmo motivo — observação é recado curto, não relato.
 */

export const LIMITE_SEGUNDOS = 60;

export type Gravacao = {
  blob: Blob;
  segundos: number;
};

export function suporteGravacao(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

function tipoSuportado(): string {
  const preferidos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return preferidos.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export class GravadorDeVoz {
  private recorder: MediaRecorder | null = null;
  private pedacos: Blob[] = [];
  private trilha: MediaStream | null = null;
  private inicio = 0;

  async comecar(): Promise<void> {
    this.trilha = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = tipoSuportado();
    this.recorder = new MediaRecorder(this.trilha, tipo ? { mimeType: tipo } : undefined);
    this.pedacos = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.pedacos.push(e.data);
    };
    this.inicio = Date.now();
    this.recorder.start();
  }

  async parar(): Promise<Gravacao> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("Nada sendo gravado");

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(this.pedacos, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });

    // Solta o microfone: sem isso o indicador do Android fica ligado.
    this.trilha?.getTracks().forEach((t) => t.stop());
    this.trilha = null;
    this.recorder = null;

    return { blob, segundos: Math.round((Date.now() - this.inicio) / 1000) };
  }

  descartar(): void {
    this.recorder?.stop();
    this.trilha?.getTracks().forEach((t) => t.stop());
    this.trilha = null;
    this.recorder = null;
    this.pedacos = [];
  }
}
