# Breadcrumb Navigation Component

Composant de navigation par fil d'Ariane réutilisable pour l'application GEO LAMBERT.

## Fonctionnalités

- ✅ Navigation cliquable entre les pages
- ✅ Page actuelle en bleu et non cliquable
- ✅ Scroll horizontal automatique pour les longs chemins
- ✅ Icônes personnalisables pour chaque niveau
- ✅ Accessibilité intégrée

## Utilisation

### Import

```tsx
import Breadcrumb, { BreadcrumbItem } from '@/components/navigation/Breadcrumb';
```

### Exemple basique

```tsx
<Breadcrumb 
  items={[
    {
      label: 'Projets',
      icon: 'home-outline',
      onPress: () => router.push('/(tabs)/')
    },
    {
      label: project.name,
      icon: 'briefcase',
      // Pas de onPress = page actuelle, non cliquable
    }
  ]}
/>
```

### Exemple avec 3 niveaux

```tsx
<Breadcrumb 
  items={[
    {
      label: 'Projets',
      icon: 'home-outline',
      onPress: () => router.push('/(tabs)/')
    },
    {
      label: 'Nom du Projet',
      icon: 'briefcase',
      onPress: () => router.push({
        pathname: '/(tabs)/project-details',
        params: { project: JSON.stringify(project) }
      })
    },
    {
      label: 'Dépenses',
      icon: 'receipt',
      // Page actuelle - automatiquement non cliquable et en bleu
    }
  ]}
/>
```

## Props

### `items: BreadcrumbItem[]`

Array d'objets `BreadcrumbItem` représentant chaque niveau de navigation.

### `BreadcrumbItem`

```typescript
interface BreadcrumbItem {
  label: string;                              // Texte à afficher
  icon: keyof typeof Ionicons.glyphMap;      // Nom de l'icône Ionicons
  onPress?: () => void;                       // Fonction de navigation (undefined = page actuelle)
}
```

## Règles

1. **Le dernier élément** est automatiquement stylé comme page actuelle (bleu, non cliquable)
2. **Les éléments précédents** sont cliquables SI `onPress` est défini
3. **Séparateurs** (chevrons) sont ajoutés automatiquement entre les éléments

## Style

Le composant utilise les styles Tailwind-like:
- Texte gris (#6b7280) pour les éléments cliquables
- Texte bleu (#3b82f6) pour la page actuelle
- Fond blanc avec bordure grise claire
- Scroll horizontal activé automatiquement

## Accessibilité

- Rôles ARIA appropriés (`button` pour les éléments cliquables)
- Labels d'accessibilité générés automatiquement
- Support complet du lecteur d'écran

## Exemples d'utilisation dans l'app

### Page projet (project-details.tsx)
```
Projets > Nom du Projet
```

### Page dépenses (task-expenses.tsx)
```
Projets > Nom du Projet > Dépenses
```

## Notes techniques

- Compatible avec Expo Router
- Utilise `react-native-vector-icons` (Ionicons)
- TypeScript avec types complets
- Pas de dépendances externes supplémentaires
