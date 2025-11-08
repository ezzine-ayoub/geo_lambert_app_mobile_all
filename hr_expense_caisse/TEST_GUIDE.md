# Guide de Test Rapide - Synchronisation des Filtres

## ✅ Tests à effectuer

### Test 1: Filtre Caisse (Dashboard → Liste)
**Objectif:** Vérifier que sélectionner une caisse dans le dropdown filtre la liste

**Étapes:**
1. Ouvrir la vue avec le dashboard
2. Dans le dropdown "Caisse", sélectionner une caisse spécifique (ex: "Demo Caisse - Administrator")
3. **✅ Vérifier:** La liste en dessous affiche uniquement les mouvements de cette caisse
4. **✅ Vérifier:** Les KPIs (Solde, Dépenses, Alimentations) se mettent à jour
5. **✅ Vérifier:** Le compteur de résultats est correct

**Console:**
```javascript
// Devrait afficher les logs:
// 🔄 SYNC: Application filtres dashboard vers liste
// ✅ SYNC: Filtres appliqués avec succès
```

---

### Test 2: Filtre Mois (Dashboard → Liste)
**Objectif:** Vérifier que sélectionner un mois filtre correctement

**Étapes:**
1. Sélectionner une caisse d'abord
2. Sélectionner un mois dans le dropdown "Mois"
3. **✅ Vérifier:** Seuls les mouvements de ce mois s'affichent
4. **✅ Vérifier:** Les statistiques du mois s'affichent si disponibles
5. Changer le mois
6. **✅ Vérifier:** La liste se met à jour immédiatement

---

### Test 3: Filtre Employé (Dashboard → Liste)
**Objectif:** Vérifier le filtrage par employé

**Étapes:**
1. Sélectionner un employé dans le dropdown "Employé"
2. **✅ Vérifier:** Seuls les mouvements de cet employé s'affichent
3. Combiner avec un filtre de caisse
4. **✅ Vérifier:** Les deux filtres s'appliquent ensemble (AND)

---

### Test 4: Filtre Date (Dashboard → Liste)
**Objectif:** Vérifier le filtrage par date spécifique

**Étapes:**
1. Sélectionner une date dans l'input date
2. **✅ Vérifier:** Seuls les mouvements de ce jour s'affichent
3. **✅ Vérifier:** Le filtre mois est réinitialisé (incompatible)
4. Changer la date
5. **✅ Vérifier:** Les résultats se mettent à jour

---

### Test 5: Recherche Textuelle (Liste → Dashboard)
**Objectif:** Vérifier que la barre de recherche met à jour le dashboard

**Étapes:**
1. Dans la barre de recherche de la liste, taper le nom d'une caisse
2. **✅ Vérifier:** Le dashboard affiche les statistiques filtrées
3. **✅ Vérifier:** Les KPIs se mettent à jour
4. Effacer la recherche
5. **✅ Vérifier:** Le dashboard revient à l'état initial

**Console:**
```javascript
// Devrait afficher:
// 🔍 CONTROLLER: Vérification domain
// 📢 CONTROLLER: Notification dashboard du changement
// ✅ EXTRACT: Filtres extraits
```

---

### Test 6: Filtres Avancés Liste (Liste → Dashboard)
**Objectif:** Vérifier que les filtres avancés de la liste affectent le dashboard

**Étapes:**
1. Utiliser les filtres avancés d'Odoo (menu déroulant à droite)
2. Filtrer par type de dépense (Spent/Replenish)
3. **✅ Vérifier:** Le dashboard affiche "Type filtré" dans les badges
4. **✅ Vérifier:** Les statistiques correspondent au type sélectionné
5. Ajouter un filtre de montant (> 100)
6. **✅ Vérifier:** Le badge "Montant > 100" apparaît

---

### Test 7: Réinitialisation Complète
**Objectif:** Vérifier la réinitialisation de tous les filtres

**Étapes:**
1. Appliquer plusieurs filtres (caisse + mois + employé)
2. Cliquer sur le bouton "Actualiser" 
3. **✅ Vérifier:** Les dropdowns restent sélectionnés
4. **✅ Vérifier:** Les données sont rechargées
5. Supprimer manuellement tous les filtres de la barre de recherche
6. **✅ Vérifier:** Le dashboard revient à l'état "Toutes les caisses"

**Console:**
```javascript
// Devrait afficher:
// 🔄 DASHBOARD: Réinitialisation complète détectée
```

---

### Test 8: Combinaison Multiple (Bidirectionnel)
**Objectif:** Tester la synchronisation bidirectionnelle complexe

**Étapes:**
1. Sélectionner une caisse dans le dashboard
2. Ajouter une recherche textuelle dans la liste
3. **✅ Vérifier:** Les deux filtres s'appliquent (AND)
4. Sélectionner un mois dans le dashboard
5. **✅ Vérifier:** Tous les filtres restent actifs
6. Supprimer la recherche textuelle
7. **✅ Vérifier:** Les filtres du dashboard restent actifs

---

### Test 9: Performance et Stabilité
**Objectif:** Vérifier qu'il n'y a pas de boucles infinies

**Étapes:**
1. Changer rapidement plusieurs fois de caisse (5-10 fois)
2. **✅ Vérifier:** Pas de ralentissement
3. **✅ Vérifier:** Pas d'erreurs dans la console
4. Ouvrir l'onglet Network
5. **✅ Vérifier:** Nombre raisonnable de requêtes (pas de flood)

**Console:**
```javascript
// NE DEVRAIT PAS afficher:
// ❌ Erreur
// ⚠️ Boucle détectée
```

---

### Test 10: Persistance URL (Navigation)
**Objectif:** Vérifier que les filtres survivent au rechargement

**Étapes:**
1. Appliquer des filtres (caisse + mois)
2. Noter l'URL (contient `caisse_filter=1&month_filter=5`)
3. Rafraîchir la page (F5)
4. **✅ Vérifier:** Les filtres sont restaurés
5. **✅ Vérifier:** Les dropdowns sont présélectionnés
6. **✅ Vérifier:** Les résultats correspondent

---

## 🐛 Problèmes Connus et Solutions

### Problème 1: Liste ne se met pas à jour
**Symptômes:** Changement de filtre dans dashboard mais liste reste identique

**Solution:**
1. Ouvrir la console (F12)
2. Vérifier les logs: `🔄 SYNC: Application filtres`
3. Vérifier: `window.expenseDashboard.state`
4. Si aucun log → Problème d'événement
5. Vérifier le code de `emitFilterChangeEvent()`

### Problème 2: Dashboard ne se met pas à jour
**Symptômes:** Recherche dans liste mais KPIs restent identiques

**Solution:**
1. Vérifier les logs: `📢 CONTROLLER: Notification dashboard`
2. Vérifier: `window.expenseDashboard.externalFilters`
3. Si vide → Problème d'extraction
4. Vérifier le code de `extractDashboardFilters()`

### Problème 3: Boucle infinie
**Symptômes:** Console flooded de logs, page freeze

**Solution:**
1. Recharger la page
2. Vérifier les flags:
   - `this.isApplyingExternalFilters`
   - `this.syncState.isApplyingFilter`
3. Augmenter les timeouts si nécessaire

### Problème 4: Filtres incohérents
**Symptômes:** Dropdown affiche une valeur, résultats en montrent une autre

**Solution:**
1. Cliquer sur "Actualiser"
2. Vider le cache du navigateur
3. Vérifier si `externalFilters` override `state`

---

## 📊 Checklist Complète

Avant de considérer la fonctionnalité comme validée:

- [ ] Test 1: Filtre Caisse fonctionne
- [ ] Test 2: Filtre Mois fonctionne
- [ ] Test 3: Filtre Employé fonctionne
- [ ] Test 4: Filtre Date fonctionne
- [ ] Test 5: Recherche textuelle fonctionne
- [ ] Test 6: Filtres avancés fonctionnent
- [ ] Test 7: Réinitialisation fonctionne
- [ ] Test 8: Combinaisons multiples fonctionnent
- [ ] Test 9: Pas de problème de performance
- [ ] Test 10: Persistance URL fonctionne

---

## 🚀 Commandes Rapides de Debug

```javascript
// Voir l'état actuel du dashboard
window.expenseDashboard.state

// Voir les filtres externes appliqués
window.expenseDashboard.externalFilters

// Forcer un rechargement
await window.expenseDashboard.refreshData()

// Vérifier le nombre de mouvements
window.expenseDashboard.state.expenseMovements.length

// Voir le domaine actuel du modèle (côté controller)
// (Nécessite d'accéder au controller - plus complexe)
```

---

## 📝 Rapport de Test

**Date:** _________________
**Testeur:** _________________
**Version Odoo:** 18.0

| Test | Status | Notes |
|------|--------|-------|
| Test 1: Filtre Caisse | ⬜ | |
| Test 2: Filtre Mois | ⬜ | |
| Test 3: Filtre Employé | ⬜ | |
| Test 4: Filtre Date | ⬜ | |
| Test 5: Recherche | ⬜ | |
| Test 6: Filtres Avancés | ⬜ | |
| Test 7: Réinitialisation | ⬜ | |
| Test 8: Combinaisons | ⬜ | |
| Test 9: Performance | ⬜ | |
| Test 10: Persistance | ⬜ | |

**Bugs trouvés:**
- 
- 

**Suggestions d'amélioration:**
- 
- 

---
**Signature:** ___________________
