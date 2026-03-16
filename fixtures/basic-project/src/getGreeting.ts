import type Greeting from "./Greeting";

const getGreeting = (name: string) => {
  const greeting: Greeting = {
    message: `hello, ${name}`
  };

  return greeting.message;
};

export default getGreeting;
