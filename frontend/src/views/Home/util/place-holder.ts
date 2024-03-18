const placeHolders = [
    'https://... 🚀 🧪 a video site but illegal one',
    'https://... 🌐 📚 a encyclopedia',
    'https://... 🫵 🧪 a another video site but legal one',
    'https://... 🔍 🔤 a search engine'
]

export const getRandomPlaceholder = () => {
    return placeHolders[Math.floor(Math.random() * placeHolders.length)]
}

