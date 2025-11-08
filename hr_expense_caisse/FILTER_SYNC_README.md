# Synchronisation des Filtres - Dashboard et Liste

## Vue d'ensemble

Ce système permet une synchronisation bidirectionnelle entre:
1. **Les filtres du dashboard** (select boxes pour Caisse, Mois, Employé, Date)
2. **La vue liste** (tableau avec résultats filtrés)

## Comment ça fonctionne

### 1. Dashboard → Liste (Filtres select vers table)

Quand l'utilisateur change un filtre dans le dashboard:

```javascript
// Dans expense_dashboard.js
async onCaisseFilterChange(event) {
    // 1. Mettre à jour l'état local
    this.state.selectedCaisses = [parseInt(event.target.value)];
    
    // 2. Recharger les données du dashboard
    await this.loadDashboardData();
    
    // 3. Émettre l'événement pour synchroniser la liste
    this.emitFilterChangeEvent();
}
```

L'événement est émis via:
- `window.dispatchEvent()` - Pour compatibilité globale
- `this.env.bus.trigger()` - Pour le bus Odoo

### 2. Liste → Dashboard (Recherche/filtres table vers dashboard)

Quand l'utilisateur utilise la barre de recherche ou les filtres de la liste:

```javascript
// Dans list.js (Controller)
handleSearchFilterChange() {
    // 1. Détecter le changement de domaine
    const currentDomain = this.model?.root?.domain || [];
    
    // 2. Extraire les filtres
    const filters = this.extractDashboardFilters(currentDomain);
    
    // 3. Notifier le dashboard
    this.notifyDashboardOfSearchChange(currentDomain);
}
```

Le dashboard reçoit l'événement et applique les filtres:
```javascript
// Dans expense_dashboard.js
async applySearchFilters(searchFilters) {
    // 1. Extraire les IDs de caisse, mois, employé
    if (searchFilters.caisseIds) {
        this.externalFilters.caisseIds = searchFilters.caisseIds;
    }
    
    // 2. Recharger les données avec les nouveaux filtres
    await this.loadDashboardData();
}
```

## Architecture des événements

### Événements émis

#### `dashboard-filter-changed`
Émis par le dashboard quand un filtre change.

**Payload:**
```javascript
{
    caisseIds: [1, 2],           // IDs des caisses sélectionnées
    monthId: 5,                   // ID du mois sélectionné
    selectedDate: '2025-01-15',   // Date sélectionnée
    employeeId: 3,                // ID de l'employé sélectionné
    domain: [...],                // Domaine Odoo complet
    expectedCount: 42,            // Nombre de résultats attendus
    timestamp: 1234567890         // Pour éviter les doublons
}
```

#### `search-filter-changed`
Émis par le controller de la liste quand la recherche change.

**Payload:**
```javascript
{
    caisseIds: [1],              // IDs extraits du domaine
    monthId: 5,                   // ID du mois extrait
    employeeIds: [3],             // IDs des employés extraits
    projectIds: [10],             // IDs des projets
    userIds: [20],                // IDs des utilisateurs
    expenseType: 'spent',         // Type de dépense
    validationStatus: 'valid',    // Statut de validation
    hasAttachments: true,         // Présence de pièces jointes
    amountCondition: {...},       // Conditions sur le montant
    generalSearch: "texte",       // Recherche textuelle
    dateRange: {...},             // Plage de dates
    searchDomain: [...],          // Domaine complet
    timestamp: 1234567890,        // Pour éviter les doublons
    source: 'search',             // Source de l'événement
    isCompleteReset: false        // Si c'est une réinitialisation totale
}
```

## Filtres supportés

### Filtres Dashboard (internes)
- ✅ Caisse (select)
- ✅ Mois (select)
- ✅ Employé (select)
- ✅ Date (input date)

### Filtres Liste (externes)
- ✅ Caisse (recherche par nom ou ID)
- ✅ Mois (filtrage par période)
- ✅ Employé (recherche par nom ou ID)
- ✅ Projet (filtrage par projet)
- ✅ Utilisateur (filtrage par user_id)
- ✅ Type de dépense (spent/replenish)
- ✅ Statut de validation
- ✅ Pièces jointes (avec/sans)
- ✅ Montant (conditions)
- ✅ Recherche textuelle générale
- ✅ Plage de dates

## Mécanismes de détection

### 1. Observer DOM (Mutation Observer)
```javascript
setupDOMObserver() {
    this.domObserver = new MutationObserver((mutations) => {
        // Détecter les changements dans la barre de recherche
        if (node.classList?.contains('o_searchview_facet')) {
            this.handleSearchFilterChange();
        }
    });
}
```

### 2. Polling périodique
```javascript
setupPeriodicCheck() {
    this.periodicInterval = setInterval(() => {
        const currentDomain = this.model?.root?.domain || [];
        if (domainChanged) {
            this.notifyDashboardOfSearchChange(currentDomain);
        }
    }, 500);
}
```

### 3. Hooks lifecycle Odoo
```javascript
async reload(params) {
    const result = await super.reload(params);
    await this.handleSearchFilterChangeAsync();
    return result;
}
```

## Extraction des filtres

La fonction `extractDashboardFilters()` analyse le domaine Odoo:

```javascript
extractDashboardFilters(searchDomain) {
    const filters = {
        caisseIds: null,
        monthId: null,
        employeeIds: null,
        // ... autres filtres
    };
    
    for (const condition of searchDomain) {
        const [field, operator, value] = condition;
        
        // Exemple: ['expense_account_id', 'in', [1, 2]]
        if (field === 'expense_account_id') {
            filters.caisseIds = value;
        }
        
        // Exemple: ['employee_id', '=', 5]
        if (field === 'employee_id') {
            filters.employeeIds = [value];
        }
    }
    
    return filters;
}
```

## Gestion des conflits

### Problème: Boucle infinie
**Solution:** Utilisation de flags `isApplyingFilter` et `isApplyingExternalFilters`

```javascript
// Dashboard
if (this.isApplyingExternalFilters) {
    return; // Ne pas émettre pendant qu'on applique
}

// Controller
if (this.syncState.isApplyingFilter) {
    return; // Ne pas appliquer si déjà en cours
}
```

### Problème: Réinitialisation non détectée
**Solution:** Détection explicite de la réinitialisation

```javascript
const isCompleteReset = (
    searchFilters.isCompleteReset === true ||
    (searchFilters.searchDomain && searchFilters.searchDomain.length === 0) ||
    // Tous les filtres sont vides
);
```

## Débogage

### Activer les logs
Les logs sont déjà présents dans le code avec des préfixes:
- `✅` - Succès
- `❌` - Erreur
- `⚠️` - Avertissement
- `🔍` - Recherche/Extraction
- `🔄` - Rechargement
- `📢` - Émission d'événement
- `📡` - Réception d'événement

### Outils de débogage

1. **Accéder au dashboard dans la console:**
```javascript
window.expenseDashboard
```

2. **Voir les filtres actuels:**
```javascript
window.expenseDashboard.state
window.expenseDashboard.externalFilters
```

3. **Forcer un rechargement:**
```javascript
await window.expenseDashboard.refreshData()
```

## Limitations connues

1. **Les filtres de caisse ne sont pas synchronisés dans les dropdowns**
   - Raison: Éviter les conflits entre filtres internes et externes
   - Les `externalFilters.caisseIds` sont utilisés pour le filtrage mais pas pour mettre à jour le select

2. **Le polling peut causer des performances**
   - Solution: Intervalle de 500ms est un compromis
   - Peut être augmenté si nécessaire

3. **Les recherches textuelles complexes**
   - La résolution des noms en IDs peut échouer
   - Utilise `resolveCaisseFromSearch()` pour la correspondance

## Tests recommandés

### Scénario 1: Dashboard → Liste
1. Sélectionner une caisse dans le dropdown
2. Vérifier que la liste se filtre
3. Vérifier que le compteur de résultats est correct

### Scénario 2: Liste → Dashboard
1. Utiliser la barre de recherche pour filtrer
2. Vérifier que les KPIs se mettent à jour
3. Vérifier que les dropdowns restent cohérents

### Scénario 3: Réinitialisation
1. Appliquer plusieurs filtres
2. Cliquer sur "Actualiser" ou retirer tous les filtres
3. Vérifier que tout revient à l'état initial

### Scénario 4: Filtres multiples
1. Combiner caisse + mois + employé
2. Ajouter une recherche textuelle
3. Vérifier que tous les filtres s'appliquent correctement

## Maintenance

### Ajouter un nouveau filtre

1. **Dans le dashboard (expense_dashboard.js):**
```javascript
// Ajouter dans state
this.state = useState({
    selectedNewFilter: null,
    // ...
});

// Ajouter le handler
async onNewFilterChange(event) {
    this.state.selectedNewFilter = parseInt(event.target.value);
    await this.loadDashboardData();
    this.emitFilterChangeEvent();
}

// Ajouter dans emitFilterChangeEvent
const filterData = {
    newFilter: this.state.selectedNewFilter,
    // ...
};

// Ajouter dans loadExpenseMovements
if (this.state.selectedNewFilter) {
    domain.push(['new_field', '=', this.state.selectedNewFilter]);
}
```

2. **Dans le controller (list.js):**
```javascript
// Ajouter dans extractDashboardFilters
const filters = {
    newFilterId: null,
    // ...
};

// Ajouter l'extraction
if (field === 'new_field') {
    filters.newFilterId = value;
}
```

3. **Dans le XML:**
```xml
<div style="flex: 1; min-width: 200px;">
    <label>Nouveau Filtre</label>
    <select t-on-change="onNewFilterChange">
        <option value="">Tous</option>
        <!-- options -->
    </select>
</div>
```

## Support

Pour toute question ou problème:
1. Vérifier les logs de la console
2. Vérifier l'état avec `window.expenseDashboard`
3. Tester les scénarios ci-dessus
4. Consulter ce README

---
**Dernière mise à jour:** 30 octobre 2025
**Version:** 1.0
