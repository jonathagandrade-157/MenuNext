import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Padrão do Next.js é 1 MB — insuficiente para createProductAction,
      // que envia até 5 imagens de 5 MB cada (MAX_PRODUCT_IMAGES/
      // MAX_IMAGE_SIZE_BYTES em src/lib/storage/assets.ts) na mesma
      // requisição multipart do produto. 30mb cobre esse pior caso (25 MB)
      // com folga para o overhead de multipart/form-data.
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
