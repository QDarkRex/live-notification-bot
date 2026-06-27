import { env } from "@/common/utils/envConfig";
import { jkt48ApiGet } from "@/common/utils/jkt48Api";
import type { FlareSolved } from "@/common/utils/news";
import axios from "axios";
import * as cheerio from "cheerio";

interface Member {
  nama_member: string;
  id_member?: string | undefined;
  ava_member?: string | undefined;
  kategori: string;
}

interface MemberDetail {
  name: string;
  birthdate: string;
  bloodType: string;
  zodiac: string;
  height: string;
  nickname: string;
  profileImage: string;
}

/** Item shape from GET /api/v1/members */
interface MemberApiItem {
  type: string; // team (e.g. "PASSION", "DREAM", "TRAINEE")
  code: string; // e.g. "ABIGAIL_RACHEL" — used as the id now
  name: string;
  nickname: string;
  photo: string;
  jkt48_member_id: number;
}

/**
 * jkt48.com migrated to a Nuxt SPA + JSON API. The member list now comes from
 *   GET /api/v1/members?lang=id
 * and members are keyed by a string `code` instead of the old numeric id.
 */
export const fetchMemberData = async (): Promise<MemberApiItem[] | null> => {
  try {
    return await jkt48ApiGet<MemberApiItem[]>("members?lang=id");
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching member data:", err.message);
    return null;
  }
};

export const parseMemberData = (items: MemberApiItem[]) => {
  const member: Member[] = (items ?? []).map((m) => ({
    nama_member: m.name,
    id_member: m.code,
    ava_member: m.photo,
    kategori: m.type,
  }));

  return { member };
};

export const fetchMemberDataId = async (memberId: number) => {
  const url = `${env.FLARE_SOLVER_BASE}/v1`;

  const response = await axios.post<FlareSolved>(
    url,
    {
      cmd: "request.get",
      url: `https://jkt48.com/member/detail/id/${memberId}?lang=id`,
      maxTimeout: 60000,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  return response.data.solution.response;
};

export const parseMemberDataId = (html: string) => {
  const $ = cheerio.load(html);
  const memberData: MemberDetail = {
    birthdate: "",
    bloodType: "",
    height: "",
    name: "",
    nickname: "",
    profileImage: "",
    zodiac: "",
  };

  memberData.name = $(".entry-mypage__item--content").eq(0).text().trim();
  memberData.birthdate = $(".entry-mypage__item--content").eq(1).text().trim();
  memberData.bloodType = $(".entry-mypage__item--content").eq(2).text().trim();
  memberData.zodiac = $(".entry-mypage__item--content").eq(3).text().trim();
  memberData.height = $(".entry-mypage__item--content").eq(4).text().trim();
  memberData.nickname = $(".entry-mypage__item--content").eq(5).text().trim();

  // Add profile image with full URL
  const relativeProfileImagePath = $(".entry-mypage__profile img").attr("src");
  memberData.profileImage = `https://jkt48.com${relativeProfileImagePath}`;

  return memberData;
};

export const fetchMemberSocialMediaId = async (id: number) => {
  const url = `${env.FLARE_SOLVER_BASE}/v1`;
  const response = await axios.post<FlareSolved>(
    url,
    {
      cmd: "request.get",
      url: `https://jkt48.com/member/detail/id/${id}?lang=id`,
      maxTimeout: 60000,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
  return response.data.solution.response;
};

export const parseMemberSocialMediaId = (html: string) => {
  const $ = cheerio.load(html);

  const socialMedia = {
    twitter: $("#twitterprofile").find("a").attr("href"),
    instagram: $(".entry-mypage__history").find("a[href*='instagram']").attr("href"),
    tiktok: $(".entry-mypage__history").find("a[href*='tiktok']").attr("href"),
  };

  if (socialMedia.twitter) {
    const twitterUsername = socialMedia.twitter
      .replace("https://twitter.com/", "")
      .replace("https://www.twitter.com/", "");
    socialMedia.twitter = `https://x.com/${twitterUsername}/`;
  }

  return socialMedia;
};
