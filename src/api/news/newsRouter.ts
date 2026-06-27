import { fetchNewsData, fetchNewsDetail, parseNewsData } from "@/common/utils/news";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";

export const newsRegistry = new OpenAPIRegistry();
export const newsRouter: Router = express.Router();

newsRouter.get("/", async (req, res) => {
  try {
    const html = await fetchNewsData();
    if (!html) {
      return res.status(500).json({ error: "Failed to fetch news data" });
    }
    const parsedData = parseNewsData(html);
    return res.status(200).json(parsedData);
  } catch (error) {
    const err = error as Error;
    console.error("Error in /news route:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

newsRouter.get("/detail/:id", async (req, res) => {
  // The new jkt48 API keys news by slug, not a numeric id.
  const id = req.params.id;

  try {
    const newsDetail = await fetchNewsDetail(id);
    if (newsDetail) {
      return res.status(200).json({ success: true, data: newsDetail });
    }
    return res.status(404).json({ error: "News not found" });
  } catch (error) {
    console.error("Error fetching news detail:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
