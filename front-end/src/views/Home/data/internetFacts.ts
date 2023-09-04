interface IRandomInternetFacts {
  text: string
  source: string
}

const randomInternetFacts: Array<IRandomInternetFacts> = [
  {
    text: 'Asia accounts for 1.7 billion of the internet’s 3.26 billion users.',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  },
  {
    text: 'YouTube uploads 72 hours of video every single minute. Yes, it is mostly people’s pets.',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  },
  {
    text: 'The current estimate of internet users is roughly 3.26 billion worldwide, or less than half of Earth’s population',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  },
  {
    text: 'One of the inventors of web as we know it, Tim Berners-Lee, was knighted by Queen Elizabeth.',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  },
  {
    text: ' It is estimated that by 2020, a quarter of a billion vehicles will have internet connection.',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  },
  {
    text: 'The majority of internet use is not done by humans, but by malware and internet bots, which account for two-thirds of internet activity.',
    source: 'https://bluespan.com/blog/20-interesting-facts-about-the-internet'
  }
]

const getRandomInternetFact = () => {
  return randomInternetFacts[Math.floor(Math.random() * randomInternetFacts.length)]
}

export { getRandomInternetFact, IRandomInternetFacts }
