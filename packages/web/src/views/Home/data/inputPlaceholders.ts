import { pickRandom } from "@/lib/random";

const placeholders: [string, ...string[]] = [
  "https://... 🚀 🧪 a video site but illegal one",
  "https://... 🌐 📚 a encyclopedia",
  "https://... 🫵 🧪 a another video site but legal one",
  "https://... 🔍 🔤 a search engine",
];

export function getRandomPlaceholder(): string {
  return pickRandom(placeholders);
}
