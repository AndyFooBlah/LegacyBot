// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export const conversationHistory = [
  { speaker: 'bot', text: 'Good morning, Dr. Vance. Thank you for making the time today. Shall we begin?' },
  { speaker: 'user', text: 'Good morning. Yes, I\'m ready. Please, call me Eleanor.' },
  { speaker: 'bot', text: 'Of course, Eleanor. I thought we could start at the very beginning. Can you tell me a bit about where you grew up?' },
  { speaker: 'user', text: 'I grew up in rural Montana. A little town called Big Sky, though it was much smaller back then. Mostly just wide-open spaces and, at night, the most incredible stars you have ever seen.' },
  { speaker: 'bot', text: 'It sounds beautiful. Was that where your fascination with the stars began?' },
  { speaker: 'user', text: 'Oh, absolutely. My father was a lawyer, but his real passion was astronomy. He had a small telescope, a Meade reflector, and he taught me the constellations before I could properly read.' },
  { speaker: 'bot', text: 'A special memory, it seems.' },
  { speaker: 'user', text: 'It is. Those cold, clear nights are etched in my memory. A sense of wonder... it never really leaves you.' },
  { speaker: 'bot', text: 'Did you find that sense of wonder was encouraged at school?' },
  { speaker: 'user', text: 'In some ways, yes. I excelled in mathematics. But in the 1950s and 60s... let\'s just say the guidance counselors weren\'t exactly pushing young women towards physics.' },
  { speaker: 'bot', text: 'How did you navigate that?' },
  { speaker: 'user', text: 'With a healthy dose of stubbornness, I suppose. My father was my greatest advocate. He always told me, "Don\'t let anyone else define your universe." I held onto that.' },
  { speaker: 'bot', text: 'That\'s a wonderful piece of advice. It seems to have served you well, leading you all the way to MIT.' },
  { speaker: 'user', text: 'It did. Though I must admit, arriving in Cambridge from rural Montana was quite the culture shock. I felt like I had landed on another planet.' },
  { speaker: 'bot', text: 'How did you adapt to life at MIT?' },
  { speaker: 'user', text: 'I buried myself in the work. The physics library became my sanctuary. It was there I first read about the concept of using transit photometry. It was purely theoretical at the time.' },
  { speaker: 'bot', text: 'And that planted a seed for your future work?' },
  { speaker: 'user', text: 'A very small one. The technology was decades away. But the idea... the simple, elegant idea that you could detect a world just by measuring the dimming of its star... it was captivating.' },
  { speaker: 'bot', text: 'After MIT, you went to Caltech and then to NASA. What was the environment at NASA\'s Ames Research Center like in the 70s?' },
  { speaker: 'user', text: 'It was an exciting time. The Apollo missions had ignited public imagination. There was a sense that anything was possible. My corner of Ames was a bit more... methodical. We were playing the long game.' },
  { speaker: 'bot', text: 'The long game being the Kepler mission?' },
  { speaker: 'user', text: 'Precisely. We were designing the photometer. The instrument had to be so sensitive it could detect a flea crawling across a car headlight from miles away. That was the analogy we used, anyway.' },
  { speaker: 'bot', text: 'How do you even begin to design something like that?' },
  { speaker: 'user', text: 'Very, very carefully. And with a lot of failed attempts. There were years where it felt like we were making no progress at all. The CCD technology, the data processing... it was all on the bleeding edge.' },
  { speaker: 'bot', text: 'It must have been frustrating.' },
  { speaker: 'user', text: 'At times, deeply. But we had a core group of believers. We kept the project alive, secured funding year after year, even when it wasn\'t the "glamorous" mission.' },
  { speaker: 'bot', text: 'What was the feeling when Kepler finally launched in 2009?' },
  { speaker: 'user', text: 'It’s hard to describe. It was a lifetime of work sitting on top of a very large, very powerful firework. A mixture of terror and exhilaration.' },
  { speaker: 'bot', text: 'And then the waiting began.' },
  { speaker: 'user', text: 'Yes. The telescope had to calibrate, and then it just... stared. For years. We would get the data down, and the analysis was this immense computational task. Sifting for needles in a cosmic haystack.' },
  { speaker: 'bot', text: 'Let\'s talk about one of those needles: Kepler-186f. When did you first realize you had something special?' },
  { speaker: 'user', text: 'The initial signal was faint, just a few pixels dimming by a fraction of a percent. We had hundreds of candidates like that. But this one... it was in the right kind of star system, and the periodicity was stable.' },
  { speaker: 'bot', text: 'What was the final confirmation process like?' },
  { speaker: 'user', text: 'It took months of follow-up observations. Ruling out every other possibility. Was it a binary star system? An instrument artifact? We had a checklist a mile long. The team was meticulous.' },
  { speaker: 'bot', text: 'And the moment it was confirmed?' },
  { speaker: 'user', text: 'It wasn’t a "eureka" moment. There was no shouting. I was at my desk, looking at the final data plot. And everything just... aligned. It was a feeling of profound quiet. A resonance.' },
  { speaker: 'bot', text: 'A resonance with the universe?' },
  { speaker: 'user', text: 'Yes. For a fleeting moment, it felt like we had heard a whisper from across an unimaginable distance. A confirmation that this little blue marble isn\'t the only one of its kind.' },
  { speaker: 'bot', text: 'That discovery changed the world. How did it change you?' },
  { speaker: 'user', text: 'It gave me a sense of perspective. Our lives, our problems... they seem so small when you are contemplating entire worlds. It’s a very humbling feeling.' },
  { speaker: 'bot', text: 'After such a monumental achievement, what did retirement look like?' },
  { speaker: 'user', text: 'Gardening, mostly! And painting. Trading a cosmic canvas for a physical one. It\'s a different kind of creation, but no less satisfying.' },
  { speaker: 'bot', text: 'From the infinite to the intimate.' },
  { speaker: 'user', text: 'A good way to put it. I also spend time mentoring young scientists. Trying to be for them what my father was for me.' },
  { speaker: 'bot', text: 'Passing on that spark of wonder.' },
  { speaker: 'user', text: 'That\'s the goal. The universe is too vast and beautiful not to share.' }
] as const;
