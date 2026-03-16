import DEFAULT_NAME from "./DEFAULT_NAME";
import getGreeting from "./getGreeting";

export default async function main() {
  console.log(getGreeting(DEFAULT_NAME));
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
