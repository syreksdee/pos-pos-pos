import type { Handler } from "@netlify/functions";
import { authorize, fail, json } from "./_shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") return fail(405, "Metode permintaan tidak didukung.");
  const access = await authorize(event, ["admin", "kasir", "gudang"]);
  if (access.response) return access.response;
  return json(200, access.context!.profile);
};
