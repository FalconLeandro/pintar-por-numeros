export interface CollectionPiece {
  id: string
  title: string
  subtitle: string
  src: string
  colors: number
  minRegion: number
}

export const COLLECTION: CollectionPiece[] = [
  {
    id: 'husk',
    title: 'Husk',
    subtitle: 'La barra del concierge',
    src: '/coleccion/husk.webp',
    colors: 24,
    minRegion: 20,
  },
  {
    id: 'elenco',
    title: 'El elenco',
    subtitle: 'Retrato de grupo',
    src: '/coleccion/elenco.webp',
    colors: 32,
    minRegion: 16,
  },
  {
    id: 'alastor-fuego',
    title: 'Alastor',
    subtitle: 'Sonrisa y fuego',
    src: '/coleccion/alastor-fuego.jpg',
    colors: 24,
    minRegion: 18,
  },
  {
    id: 'retrato-rosa',
    title: 'Retrato rosa',
    subtitle: 'Color y una calavera',
    src: '/coleccion/retrato-rosa.webp',
    colors: 24,
    minRegion: 18,
  },
  {
    id: 'alastor-sombra',
    title: 'La sombra',
    subtitle: 'Alastor y su doble',
    src: '/coleccion/alastor-sombra.jpg',
    colors: 24,
    minRegion: 18,
  },
  {
    id: 'coraline',
    title: 'La puerta',
    subtitle: 'Coraline y la gata',
    src: '/coleccion/coraline.jpg',
    colors: 16,
    minRegion: 25,
  },
]
