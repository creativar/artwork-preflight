import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
}

export function DropZone({ onFile, busy }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setHover(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className={`dropzone ${hover ? 'dropzone--hover' : ''} ${busy ? 'dropzone--busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
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
      <div className="dropzone__title">{busy ? 'Analysing…' : 'Drop artwork here'}</div>
      <div className="dropzone__sub">PDF, JPG, PNG, TIFF, WebP — or click to choose</div>
    </div>
  );
}
