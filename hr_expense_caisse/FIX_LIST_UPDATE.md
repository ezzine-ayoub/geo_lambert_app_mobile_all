# Correction: Liste ne se met pas à jour avec les filtres Dashboard

## 🐛 Problème Identifié

Quand l'utilisateur change un filtre dans le dashboard (Caisse, Mois, Employé), la liste en bas ne se mettait pas à jour automatiquement.

**Cause:** Le `Renderer` n'a pas accès au `model.root` nécessaire pour recharger les données. Il faut passer par le `Controller`.

## ✅ Solution Implémentée

### Architecture de Communication

```
Dashboard (expense_dashboard.js)
    ↓ emitFilterChangeEvent()
    ↓ window.dispatchEvent('dashboard-filter-changed')
    ↓
Renderer (list.js - ExpenseDashboardListRenderer)
    ↓ setupFilterSynchronization()
    ↓ notifyControllerOfFilterChange()
    ↓ window.dispatchEvent('renderer-apply-dashboard-filter')
    ↓
Controller (list.js - ExpenseDashboardListController)
    ↓ applyDashboardFilter()
    ↓ model.root.load({ domain: ... })
    ↓
Liste mise à jour! ✅
```

## 🔧 Modifications

### 1. Renderer - Simplification

**Avant:** Le Renderer essayait d'accéder au `model` (impossible)
```javascript
// ❌ Ne fonctionne pas
async applyDashboardFiltersToSearch(filterData) {
    if (this.model && this.model.root) {
        await this.model.root.load({ domain: ... });
    }
}
```

**Après:** Le Renderer redirige vers le Controller
```javascript
// ✅ Fonctionne
setupFilterSynchronization() {
    window.addEventListener('dashboard-filter-changed', (event) => {
        this.notifyControllerOfFilterChange(event.detail);
    });
}

notifyControllerOfFilterChange(filterData) {
    const event = new CustomEvent('renderer-apply-dashboard-filter', {
        detail: filterData
    });
    window.dispatchEvent(event);
}
```

### 2. Controller - Écoute et Application

**Ajout dans `setup()`:**
```javascript
// Écouter les filtres du dashboard
window.addEventListener('renderer-apply-dashboard-filter', (event) => {
    console.log('📡 CONTROLLER: Reçu filtre dashboard:', event.detail);
    this.applyDashboardFilter(event.detail);
});

// Ajout du flag
this.filterState = useState({
    // ... autres propriétés
    isApplyingDashboardFilter: false
});
```

**Nouvelle méthode `applyDashboardFilter()`:**
```javascript
async applyDashboardFilter(filterData) {
    // Protection anti-double application
    if (this.filterState.isApplyingDashboardFilter) return;
    
    this.filterState.isApplyingDashboardFilter = true;
    
    const searchDomain = filterData.domain || [];
    
    // Recharger le modèle avec le nouveau domaine
    await this.model.root.load({
        domain: searchDomain,
        context: this.model.root.context || {},
    });
    
    // Mettre à jour lastDomain pour éviter boucle
    this.filterState.lastDomain = JSON.stringify(searchDomain);
    
    // Libérer le flag après 1s
    setTimeout(() => {
        this.filterState.isApplyingDashboardFilter = false;
    }, 1000);
}
```

**Protection dans `handleSearchFilterChange()`:**
```javascript
// Ignorer si on est en train d'appliquer un filtre dashboard
if (this.filterState.isHandlingSearch || 
    this.filterState.isApplyingDashboardFilter) {
    return;
}
```

## 🔐 Protection Anti-Boucle

### Problème Potentiel
```
Dashboard change → Apply filter → Update model 
→ Trigger handleSearchFilterChange → Notify dashboard 
→ Dashboard reload → BOUCLE!
```

### Solution
1. **Flag `isApplyingDashboardFilter`**: Bloque `handleSearchFilterChange` pendant l'application
2. **Update `lastDomain`**: Évite de détecter le changement qu'on vient de faire
3. **Timeout de 1s**: Donne le temps au système de se stabiliser

## 📊 Flux Complet

### Exemple: Sélection d'une Caisse

```
1. User sélectionne "Demo Caisse" dans le dropdown
   ↓
2. onCaisseFilterChange() appelé
   ↓
3. loadDashboardData() charge les stats
   ↓
4. emitFilterChangeEvent() émet l'événement:
   {
     caisseIds: [1],
     domain: [['expense_account_id', 'in', [1]]],
     expectedCount: 2
   }
   ↓
5. Renderer.setupFilterSynchronization() reçoit l'événement
   📡 RENDERER: Événement reçu du dashboard
   ↓
6. Renderer.notifyControllerOfFilterChange() redirige
   📢 RENDERER: Notification du controller
   ↓
7. Controller.applyDashboardFilter() applique
   🔄 CONTROLLER: Application filtre dashboard
   🎯 CONTROLLER: Domaine à appliquer: [['expense_account_id', 'in', [1]]]
   ↓
8. model.root.load() recharge les données
   🔄 CONTROLLER: Rechargement du modèle...
   ↓
9. Liste mise à jour!
   ✅ CONTROLLER: Modèle rechargé avec succès
   📊 CONTROLLER: Nombre de lignes: 2
```

## 🧪 Tests

### Test 1: Filtre Caisse
```
Action: Sélectionner "Demo Caisse"
Résultat attendu: Liste affiche seulement les mouvements de cette caisse
Console:
  📡 RENDERER: Événement reçu du dashboard
  📢 RENDERER: Notification du controller
  🔄 CONTROLLER: Application filtre dashboard
  ✅ CONTROLLER: Modèle rechargé avec succès
  📊 CONTROLLER: Nombre de lignes: 2
```

### Test 2: Filtre Employé
```
Action: Sélectionner "OMAR EL BZIZI"
Résultat attendu: Liste affiche seulement les mouvements de cet employé
Console: Logs similaires avec domain employé
```

### Test 3: Filtre Mois
```
Action: Sélectionner "Le Mois 10/2025"
Résultat attendu: Liste affiche seulement les mouvements de ce mois
Console: Logs similaires avec domain mois
```

### Test 4: Combinaison
```
Action: Sélectionner Caisse + Mois + Employé
Résultat attendu: Liste affiche mouvements avec tous les filtres (AND)
Console: Domain combiné dans les logs
```

### Test 5: Réinitialisation
```
Action: Sélectionner "Toutes les caisses"
Résultat attendu: Liste affiche tous les mouvements
Console: Domain vide []
```

## 🐛 Débogage

### Console Logs Clés

**Succès complet:**
```
📡 RENDERER: Événement reçu du dashboard: {caisseIds: [1], domain: [...]}
📢 RENDERER: Notification du controller avec: {caisseIds: [1], domain: [...]}
🔄 CONTROLLER: Application filtre dashboard: {caisseIds: [1], domain: [...]}
🎯 CONTROLLER: Domaine à appliquer: [['expense_account_id', 'in', [1]]]
🔄 CONTROLLER: Rechargement du modèle...
✅ CONTROLLER: Modèle rechargé avec succès
📊 CONTROLLER: Nombre de lignes: 2
🔓 CONTROLLER: Verrou libéré
```

**Problème: Filtre ignoré**
```
⏳ CONTROLLER: Application filtre ignorée (en cours ou vide)
```
→ Vérifier que le flag n'est pas bloqué

**Problème: Modèle non disponible**
```
⚠️ CONTROLLER: Modèle non disponible
```
→ Vérifier que le Controller a bien accès au model

**Erreur:**
```
❌ CONTROLLER: Erreur rechargement modèle: [détails]
```
→ Regarder les détails de l'erreur

### Inspection Runtime

```javascript
// Vérifier l'état du controller
window.expenseDashboard  // État du dashboard

// Vérifier si le controller reçoit les événements
// (Mettre un breakpoint dans applyDashboardFilter)

// Forcer une application manuelle
window.dispatchEvent(new CustomEvent('renderer-apply-dashboard-filter', {
    detail: {
        domain: [['expense_account_id', 'in', [1]]],
        caisseIds: [1]
    }
}));
```

## ✅ Checklist

- [x] Renderer écoute `dashboard-filter-changed`
- [x] Renderer redirige vers Controller
- [x] Controller écoute `renderer-apply-dashboard-filter`
- [x] Controller applique le filtre via `model.root.load()`
- [x] Flag `isApplyingDashboardFilter` ajouté
- [x] Protection anti-boucle dans `handleSearchFilterChange`
- [x] Logs détaillés pour débogage
- [x] Timeout de libération du flag
- [ ] Tests utilisateur effectués

## 📝 Fichiers Modifiés

- `list.js` (ExpenseDashboardListRenderer)
  - Simplification de `setupFilterSynchronization()`
  - Ajout de `notifyControllerOfFilterChange()`
  - Suppression de `applyDashboardFiltersToSearch()`

- `list.js` (ExpenseDashboardListController)
  - Ajout écoute `renderer-apply-dashboard-filter` dans `setup()`
  - Ajout flag `isApplyingDashboardFilter`
  - Nouvelle méthode `applyDashboardFilter()`
  - Protection dans `handleSearchFilterChange()`

## 🚀 Déploiement

1. **Redémarrer Odoo**
2. **Mettre à jour le module**
3. **Tester les filtres:**
   - Caisse
   - Mois
   - Employé
   - Combinaisons
4. **Vérifier la console** pour les logs

---

**Date:** 30 Octobre 2025  
**Version:** 1.1  
**Status:** ✅ Corrigé et Prêt pour Test
