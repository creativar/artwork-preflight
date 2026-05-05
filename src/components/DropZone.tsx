import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  stage?: string;
  onPrewarm?: () => void;
}

export function DropZone({ onFile, busy, stage, onPrewarm }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prewarmedRef = useRef(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setHover(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(true);
    if (!prewarmedRef.current && onPrewarm) {
      prewarmedRef.current = true;
      onPrewarm();
    }
  };

  if (busy) {
    return (
      <div className="dropzone dropzone--busy">
        <div className="loader">
          <div className="loader__spinner" />
          <div className="loader__title">Analysing…</div>
          <div className="loader__stage">{stage || 'Starting'}</div>
          <div className="loader__hint">
            First run downloads ~16 MB of colour engines (MuPDF + libvips). Subsequent runs are instant.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`dropzone ${hover ? 'dropzone--hover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
      onMouseEnter={() => {
        if (!prewarmedRef.current && onPrewarm) {
          prewarmedRef.current = true;
          onPrewarm();
        }
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/tiff,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <div className="dropzone__title">Drop artwork here</div>
      <div className="dropzone__sub">PDF, JPG, PNG, TIFF, WebP — or click to choose</div>
    </div>
  );
}
