import { jkt48ApiGet } from "@/common/utils/jkt48Api";

interface Banner {
  value?: string | undefined;
  img_url?: string | undefined;
}

/**
 * Banners moved into the homepage payload:
 *   GET /api/v1/home?lang=id  ->  data.banners[]
 * The exact banner item shape isn't documented (the array is often empty), so
 * we map the most likely field names defensively.
 */

interface HomeApi {
  banners?: HomeBanner[];
  sections?: unknown[];
  socials?: unknown[];
}

interface HomeBanner {
  url?: string;
  link?: string;
  value?: string;
  image?: string;
  img_url?: string;
  banner_image?: string;
  thumbnail_image?: string;
}

export const fetchBannerData = async (): Promise<HomeBanner[] | null> => {
  try {
    const home = await jkt48ApiGet<HomeApi>("home?lang=id");
    return home?.banners ?? [];
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching banner data:", err.message);
    return null;
  }
};

export const parseBannerData = (banners: HomeBanner[]): Banner[] => {
  return (banners ?? []).map((b) => ({
    value: b.url ?? b.link ?? b.value ?? "",
    img_url: b.image ?? b.img_url ?? b.banner_image ?? b.thumbnail_image ?? "",
  }));
};
