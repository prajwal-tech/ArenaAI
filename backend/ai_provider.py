import asyncio
import os
import random
import logging
import httpx

logger = logging.getLogger(__name__)

MOCK_OUTPUTS = [
    """**NEXUS NOIR × CHROME DREAMS**
*A Cyberpunk Luxury Fragrance Campaign*

The year is 2087. In the chrome-draped towers of Neo-Shanghai, power isn't worn—it's *exhaled*.

**THE SCENT PROFILE:**
Opening notes of liquid titanium and ozone-kissed midnight bloom into a heart of synthetic violet and black market saffron. The dry-down? Pure electric ambition bottled in obsidian.

**CAMPAIGN VISUAL:** A Gen-Z icon floats in zero-gravity, surrounded by floating holographic cherry blossoms dissolving into data streams. Their augmented eyes glow #FF2D78. The bottle: a shard of black mirror with neon circuitry etched inside.

**TAGLINE:** *"They'll smell your power before they see your face."*

**INFLUENCER ACTIVATION:** The scent releases as an NFT drop first—only top holders get the physical bottle. The unboxing IS the campaign.""",

    """**GLITCH ELIXIR BY VOLATIL3**
*For those who break the simulation*

Forget what luxury smells like. This is what it *hacks* like.

**OLFACTORY ARCHITECTURE:**
Tier 1 (Opening): Burnt circuitry, white peach, crushed ice
Tier 2 (Heart): Stolen algorithm accord, dark oud, machine oil rose
Tier 3 (Base): Memory foam musk, encrypted amber, void

**CAMPAIGN CONCEPT:**
Six Gen-Z micro-influencers each receive a different "broken" version of the bottle—each one glitching visually in AR. Only when all six gather does the true bottle emerge. Total drop: 2,087 units.

**MANIFESTO:** *You don't wear Volatil3. You run it.*

**ACTIVATION:** Scent-coded QR art installations in 7 cities. Scan = unlock your "fragrance personality" deepfake avatar.""",

    """**PHANTOM PROTOCOL**
*Luxury has a new access level*

Warning: This fragrance is classified.

**THE FORMULA (DECLASSIFIED):**
- Top: Cryo-mango, violet frequency, rain on hot concrete
- Heart: Encrypted jasmine, rare-earth mineral accord, stolen heartbeat
- Base: Ghost amber, carbon fiber musk, the feeling of being watched

**BOTTLE DESIGN:** Invisible until held—thermo-reactive glass reveals the logo only from body heat.

*"Your presence is already a statement. This is your signature."*"""
]


class AIProvider:
    """
    Priority order:
    1. Ollama (local)  — if OLLAMA_URL is set or Ollama is running on default port
    2. Anthropic API   — if ANTHROPIC_API_KEY is set
    3. Rich mock       — fallback, always works
    """

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.provider = self._detect_provider()
        logger.info(f"AI Provider: {self.provider} | model: {self.ollama_model if self.provider == 'ollama' else 'claude-3-haiku / mock'}")

    def _detect_provider(self) -> str:
        # Prefer Ollama if URL is explicitly set
        if os.getenv("OLLAMA_URL"):
            return "ollama"
        # Prefer Anthropic if key is set
        if self.anthropic_key and self.anthropic_key.startswith("sk-ant"):
            return "anthropic"
        # Default to Ollama on localhost (will fail gracefully if not running)
        return "ollama"

    async def generate(self, challenge_prompt: str, user_prompt: str) -> str:
        if self.provider == "ollama":
            try:
                return await self._generate_ollama(challenge_prompt, user_prompt)
            except Exception as e:
                logger.warning(f"Ollama failed ({e}), falling back to mock")
                return await self._generate_mock()
        elif self.provider == "anthropic":
            try:
                return await self._generate_anthropic(challenge_prompt, user_prompt)
            except Exception as e:
                logger.warning(f"Anthropic failed ({e}), falling back to mock")
                return await self._generate_mock()
        else:
            return await self._generate_mock()

    async def _generate_ollama(self, challenge_prompt: str, user_prompt: str) -> str:
        system = (
            "You are a wildly creative AI judge for a creative battle room game. "
            "Generate vivid, bold, specific creative content. Use markdown formatting "
            "(bold with **, bullet points). Aim for 150-250 words. Make it feel like "
            "real premium creative agency work, not a description of it."
        )
        prompt = (
            f"CHALLENGE: {challenge_prompt}\n\n"
            f"CONTESTANT CONCEPT: {user_prompt}\n\n"
            "Generate a creative response expanding on this concept for the challenge above."
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.ollama_model,
                    "prompt": f"System: {system}\n\nUser: {prompt}\n\nAssistant:",
                    "stream": False,
                    "options": {
                        "temperature": 0.9,
                        "num_predict": 400,
                    }
                }
            )
            response.raise_for_status()
            data = response.json()
            return data["response"].strip()

    async def _generate_anthropic(self, challenge_prompt: str, user_prompt: str) -> str:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=self.anthropic_key)
        message = await client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": (
                    f"You are a wildly creative AI judge for a creative battle room game.\n\n"
                    f"CHALLENGE: {challenge_prompt}\n\n"
                    f"CONTESTANT'S CONCEPT: {user_prompt}\n\n"
                    "Generate a vivid, creative response. Be bold and specific. "
                    "Use markdown formatting. Aim for ~200-300 words."
                )
            }]
        )
        return message.content[0].text

    async def _generate_mock(self) -> str:
        await asyncio.sleep(random.uniform(2, 5))
        if random.random() < 0.08:
            raise Exception("Mock generation service temporarily unavailable.")
        return random.choice(MOCK_OUTPUTS)


ai_provider = AIProvider()

