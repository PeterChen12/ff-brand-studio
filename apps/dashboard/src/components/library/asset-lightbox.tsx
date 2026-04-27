"use client";

import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

export interface AssetSlide extends SlideImage {
  src: string;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
}

interface AssetLightboxProps {
  slides: AssetSlide[];
  index: number;
  open: boolean;
  onClose: () => void;
}

export function AssetLightbox({
  slides,
  index,
  open,
  onClose,
}: AssetLightboxProps) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      slides={slides}
      index={index}
      plugins={[Zoom]}
      zoom={{
        maxZoomPixelRatio: 4,
        zoomInMultiplier: 1.5,
        doubleTapDelay: 300,
        doubleClickDelay: 300,
        doubleClickMaxStops: 2,
        keyboardMoveDistance: 50,
        wheelZoomDistanceFactor: 100,
        pinchZoomDistanceFactor: 100,
        scrollToZoom: true,
      }}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      styles={{
        container: { backgroundColor: "rgba(15, 15, 14, 0.92)" },
      }}
      animation={{ swipe: 250 }}
    />
  );
}
