// Mock data for the dev fake session. Kept separate from integrations.ts.
// The banned-word variant exists to exercise the fallback path: the fake
// session runs this text through the same validateRoast as the live flow.

export const FAKE_FOUNDER = {
  name: 'Dev Founder',
  email: 'founder@example.com',
  company: 'Acme Robotics',
};

export const FAKE_ANSWERS = {
  building: 'An AI copilot for warehouse logistics that automates picking routes.',
  audience: 'Operations teams at mid-size distribution centers.',
  differentiation: "We're faster than the incumbents and easier to deploy.",
};

// Passes validation (clean, within the word bounds).
const PASS_ROAST = {
  category: 'ai-agents',
  text: `Okay, real talk: I love that you pointed a language model at warehouse
logistics, because somebody finally aimed AI at a problem that involves
forklifts instead of poetry. Genuinely strong start. But here is where it
wobbles. You said your audience is operations teams, which is the startup
equivalent of saying your market is people who breathe. Narrow it. Your
differentiation is that you are faster, and faster is not a moat, it is a
sprint. An investor is going to ask how you defend this once the incumbents
wake up. Next step: pick one warehouse, one workflow, and go absurdly deep.
Your recording is on its way to your inbox, along with details on MongoDB for
Startups. Go get them.`.replace(/\s+/g, ' ').trim(),
};

// Contains a banned word (standalone) so validateRoast rejects it and the fake
// session dispatches the fallback below with source 'fallback'.
const BANNED_ROAST = {
  category: 'fintech',
  text: `Honestly? Not half bad. You are building a fintech app for freelancers,
and I mean this, the demo is good shit. But freelancers is forty million people
doing forty different jobs, so who exactly, the designers or the plumbers? Your
edge is better UX, and better UX is table stakes, not a strategy. An investor
will ask what happens when a bank clones your onboarding in a weekend. Next
step: name one customer segment and one number you move for them, then go win
it. Your recording is on its way to your inbox, plus details on MongoDB for
Startups.`.replace(/\s+/g, ' ').trim(),
};

export const FAKE_ROASTS = {
  pass: PASS_ROAST,
  banned: BANNED_ROAST,
};

// Generic clean fallback the fake session serves when validation fails, mirror-
// ing what the agent would produce on a rejected roast.
export const FALLBACK_ROAST = {
  text: `Alright, quick one, because the important part is the same for almost
every founder in this room. You clearly care about the problem, and that energy
is real, so keep it. The trap is staying vague: everyone is not a market and
better is not a moat. Pick one specific customer, one workflow you make
dramatically less painful, and one number you can move. An investor will always
ask why you win when a bigger company notices, so have that answer ready before
they do. Go deep, not wide. Your recording is on its way to your inbox, along
with details on MongoDB for Startups.`.replace(/\s+/g, ' ').trim(),
};
