interface Props {
  url: string;
  alt: string;
}

export function ImagePreview({ url, alt }: Props) {
  return (
    <div className="preview image-preview">
      <img src={url} alt={alt} />
    </div>
  );
}
