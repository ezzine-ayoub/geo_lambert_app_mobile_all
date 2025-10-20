/** @odoo-module */

import { registry } from '@web/core/registry';
import { listView } from "@web/views/list/list_view";
import { ListRenderer } from "@web/views/list/list_renderer";
import { ListController } from "@web/views/list/list_controller";
import { useService } from '@web/core/utils/hooks';
import { Component, onWillStart, useState, onMounted, onWillUnmount } from "@odoo/owl";

import { ExpenseDashboard } from '../components/expense_dashboard';

export class ExpenseDashboardListRenderer extends ListRenderer {
    static components = { ...ListRenderer.components, ExpenseDashboard };
    static template = 'hr_expense_caisse.DashboardListRenderer';
    
    setup() {
        super.setup();
        // console.log('🛠️ Setup ExpenseDashboardListRenderer');
        
        // Vérifier si c'est notre modèle spécifique
        this.showExpenseDashboard = this.props.list?.resModel === 'hr.expense.account.move';
        
        if (this.showExpenseDashboard) {
            // console.log('🛠️ Dashboard activé pour hr.expense.account.move');
            this.notification = useService('notification');
            this.orm = useService('orm');
            
            // État pour les filtres synchronisés
            this.syncState = useState({
                dashboardFiltered: false,
                lastSearchDomain: null,
                isApplyingFilter: false
            });
            
            // Écouter les changements de filtres du dashboard
            onMounted(() => {
                this.setupFilterSynchronization();
            });
            
            // Nettoyer les observateurs lors de la destruction (dans le renderer, on référence le controller)
            onWillUnmount(() => {
                // console.log('🧽 RENDERER: Nettoyage en cours');
                // L'observateur DOM sera nettoyé par le controller
            });
        }
    }
    
    setupFilterSynchronization() {
        // console.log('🔄 SYNC: Configuration synchronisation des filtres');
        
        // Écouter les événements du dashboard via l'environment bus
        if (this.env.bus) {
            this.env.bus.addEventListener('dashboard-filter-changed', (event) => {
                // console.log('🎯 SYNC: Réception événement dashboard via env.bus:', event.detail);
                this.applyDashboardFiltersToSearch(event.detail);
            });
        }
        
        // Écouter aussi via window pour plus de sécurité
        if (typeof window !== 'undefined') {
            window.addEventListener('dashboard-filter-changed', (event) => {
                // console.log('🌍 SYNC: Réception événement dashboard via window:', event.detail);
                this.applyDashboardFiltersToSearch(event.detail);
            });
        }
    }
    
    async applyDashboardFiltersToSearch(filterData) {
        try {
            if (!filterData || this.syncState.isApplyingFilter) {
                // console.log('⏭️ SYNC: Ignorer application filtre (déjà en cours ou pas de données)');
                return;
            }
            
            // console.log('🔄 SYNC: Application filtres dashboard vers search:', filterData);
            this.syncState.isApplyingFilter = true;
            
            // Construire le domaine depuis les filtres du dashboard
            const searchDomain = filterData.domain || [];
            // console.log('🔍 SYNC: Domaine à appliquer:', searchDomain);
            
            // Méthode alternative : utiliser l'action pour recharger avec le domaine
            if (this.env.services && this.env.services.action) {
                try {
                    const actionService = this.env.services.action;
                    
                    // Construire l'action avec le nouveau domaine
                    const action = {
                        type: 'ir.actions.act_window',
                        res_model: 'hr.expense.account.move',
                        view_mode: 'list,form',
                        views: [[false, 'list'], [false, 'form']],
                        domain: searchDomain,
                        context: {},
                        target: 'current'
                    };
                    
                    // Pas de rechargement complet, juste mise à jour du domaine
                    // console.log('✅ SYNC: Domaine mis à jour pour la vue');
                } catch (actionError) {
                    // console.warn('⚠️ SYNC: Erreur action service:', actionError);
                }
            }
            
            // Appliquer le filtre via le contrôleur de recherche si disponible
            if (this.env.searchModel) {
                try {
                    // Désactiver temporairement le filtre dashboard pour éviter les boucles
                    await this.env.searchModel.deactivateGroup('dashboard_filter');
                    
                    if (searchDomain.length > 0) {
                        // Activer le filtre dashboard avec le nouveau domaine
                        await this.env.searchModel.createNewFilters({
                            groupId: 'dashboard_filter',
                            filters: [{
                                description: 'Filtre Dashboard',
                                domain: searchDomain,
                                groupNumber: 1
                            }]
                        });
                    }
                    
                    // console.log('✅ SYNC: Filtre appliqué avec succès');
                } catch (searchError) {
                    // console.warn('⚠️ SYNC: Erreur searchModel:', searchError);
                }
            } else {
                // console.warn('⚠️ SYNC: searchModel non disponible');
            }
            
        } catch (error) {
            // console.error('❌ SYNC: Erreur application filtre:', error);
        } finally {
            // Réactiver les filtres après un délai
            setTimeout(() => {
                this.syncState.isApplyingFilter = false;
                // console.log('🔓 SYNC: Synchronisation débloquée');
            }, 1000);
        }
    }
}

export class ExpenseDashboardListController extends ListController {
    setup() {
        super.setup();
        // console.log('🛠️ Setup Controller');
        this.notification = useService('notification');
        
        // État pour détecter les changements de filtres
        this.filterState = useState({
            lastDomain: null,
            isHandlingSearch: false,
            lastCheck: Date.now()
        });
        
        // Écouter les événements du renderer
        if (typeof window !== 'undefined') {
            window.addEventListener('renderer-filter-change-detected', () => {
                // console.log('📨 CONTROLLER: Signal reçu du renderer');
                this.handleSearchFilterChange();
            });
        }
        
        // Configurer l'observateur DOM dans le contrôleur
        this.setupDOMObserver();
        
        // NOUVEAU: Polling périodique pour détecter les changements
        this.setupPeriodicCheck();
    }
    
    // NOUVELLE méthode: Vérification périodique
    setupPeriodicCheck() {
        // console.log('⏰ PERIODIC: Configuration vérification périodique');
        
        // Vérifier toutes les 500ms si le domaine a changé
        this.periodicInterval = setInterval(() => {
            try {
                const currentDomain = this.model?.root?.domain || [];
                const domainString = JSON.stringify(currentDomain);
                
                if (this.filterState.lastDomain !== domainString) {
                    // console.log('⏰ PERIODIC: Changement détecté via polling:', {
                    //     oldDomain: this.filterState.lastDomain,
                    //     newDomain: domainString,
                    //     domainLength: currentDomain.length
                    // });
                    
                    // Mise à jour immédiate pour éviter les doublons
                    this.filterState.lastDomain = domainString;
                    
                    // Traitement du changement
                    this.notifyDashboardOfSearchChange(currentDomain);
                }
            } catch (error) {
                // console.error('❌ PERIODIC: Erreur vérification périodique:', error);
            }
        }, 500); // Vérifier toutes les 500ms
        
        // console.log('✅ PERIODIC: Vérification périodique démarrée');
    }
    
    willDestroy() {
        super.willDestroy?.();
        
        // Nettoyer l'observateur DOM
        if (this.domObserver) {
            this.domObserver.disconnect();
            // console.log('🧽 CONTROLLER: Observateur DOM déconnecté');
        }
        
        // Nettoyer le polling périodique
        if (this.periodicInterval) {
            clearInterval(this.periodicInterval);
            // console.log('🧽 CONTROLLER: Vérification périodique arrêtée');
        }
    }
    
    setupDOMObserver() {
        try {
            // console.log('🔍 DOM: Configuration observateur de changements (Controller)');
            
            // Observer les changements sur les éléments de recherche
            const observerConfig = {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'data-domain', 'style']
            };
            
            const callback = (mutations) => {
                let shouldCheck = false;
                let isFilterRemoval = false;
                
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        // Détecter la suppression de facettes de filtre
                        mutation.removedNodes.forEach(node => {
                            if (node.nodeType === 1 && 
                                (node.classList?.contains('o_searchview_facet') ||
                                 node.querySelector?.('.o_searchview_facet'))) {
                                // console.log('🖪 DOM: SUPPRESSION de facette détectée:', node.className);
                                shouldCheck = true;
                                isFilterRemoval = true;
                            }
                        });
                        
                        // Détecter les ajouts aussi
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && 
                                (node.classList?.contains('o_searchview_facet') ||
                                 node.querySelector?.('.o_searchview_facet'))) {
                                // console.log('➕ DOM: AJOUT de facette détecté:', node.className);
                                shouldCheck = true;
                            }
                        });
                        
                        const target = mutation.target;
                        if (target.classList?.contains('o_searchview') ||
                            target.classList?.contains('o_search_panel') ||
                            target.closest?.('.o_search_options') ||
                            target.closest?.('.o_searchview_facet')) {
                            shouldCheck = true;
                        }
                    }
                    
                    if (mutation.type === 'attributes') {
                        const target = mutation.target;
                        if (target.classList?.contains('o_searchview') ||
                            target.classList?.contains('o_search_panel')) {
                            shouldCheck = true;
                        }
                    }
                });
                
                if (shouldCheck) {
                    // console.log('🔍 DOM: Changement détecté - planification vérification:', {
                    //     isFilterRemoval,
                    //     timestamp: Date.now()
                    // });
                    
                    if (isFilterRemoval) {
                        // Pour les suppressions, forcer la détection immédiatement
                        setTimeout(() => this.forceFilterDetection(), 100);
                    } else {
                        // Pour les autres changements, délai normal
                        setTimeout(() => this.handleSearchFilterChange(), 300);
                    }
                }
            };
            
            // Créer et lancer l'observateur
            this.domObserver = new MutationObserver(callback);
            
            // Observer le document entier pour capturer tous les changements
            if (typeof document !== 'undefined') {
                this.domObserver.observe(document.body, observerConfig);
                // console.log('✅ DOM: Observateur activé (Controller)');
            }
            
        } catch (error) {
            // console.error('❌ DOM: Erreur configuration observateur:', error);
        }
    }

    async onUpdatedPaging() {
        const result = await super.onUpdatedPaging();
        this.handleSearchFilterChange();
        return result;
    }
    
    // Override pour capturer les changements de recherche
    async onActiveElementsChanged() {
        const result = await super.onActiveElementsChanged?.();
        // console.log('🔍 SEARCH: onActiveElementsChanged déclenché - vérification filtres');
        setTimeout(() => this.handleSearchFilterChange(), 100);
        return result;
    }
    
    async load() {
        const result = await super.load();
        // console.log('🔍 SEARCH: load() déclenché - vérification filtres');
        // Délai pour s'assurer que le domaine est mis à jour
        setTimeout(() => this.handleSearchFilterChange(), 100);
        return result;
    }
    
    // Override pour capturer tous les événements de recherche
    async search(searchValue, { reload = true } = {}) {
        // console.log('🔍 SEARCH: Méthode search appelée avec:', { searchValue, reload });
        const result = await super.search?.(searchValue, { reload });
        // Délai pour s'assurer que la recherche est terminée
        setTimeout(() => this.handleSearchFilterChange(), 200);
        return result;
    }
    
    // Override pour capturer les changements de contexte
    async update(params) {
        // console.log('🔄 SEARCH: Méthode update appelée avec:', params);
        const result = await super.update(params);
        setTimeout(() => this.handleSearchFilterChange(), 100);
        return result;
    }
    
    // Override pour capturer le rechargement
    async reload(params) {
        // console.log('🔁 SEARCH: Méthode reload appelée avec:', params);
        const result = await super.reload(params);
        setTimeout(() => this.handleSearchFilterChange(), 100);
        return result;
    }
    
    // NOUVEAU: Méthode pour forcer la détection des changements
    forceFilterDetection() {
        // console.log('💪 SEARCH: Détection forcée des changements de filtres');
        // Réinitialiser le dernier domaine pour forcer la détection
        this.filterState.lastDomain = null;
        this.handleSearchFilterChange();
    }
    
    handleSearchFilterChange() {
        try {
            if (this.filterState.isHandlingSearch) {
                // console.log('⏭️ SEARCH: Déjà en cours de traitement - ignorer');
                return;
            }
            
            // Marquer comme en cours de traitement
            this.filterState.isHandlingSearch = true;
            
            // Récupérer le domaine actuel de la recherche
            const currentDomain = this.model?.root?.domain || [];
            const domainString = JSON.stringify(currentDomain);
            
            // console.log('🔍 DEBUG SEARCH: Détection changement filtres:', {
            //     currentDomain: currentDomain,
            //     domainLength: currentDomain.length,
            //     domainString: domainString,
            //     lastDomain: this.filterState.lastDomain,
            //     hasChanged: this.filterState.lastDomain !== domainString
            // });
            
            // AJOUT TEMPORAIRE DE DEBUG pour identifier le problème
            console.log('📝 DEBUG SEARCH: Détection changement filtres:', {
                currentDomain: currentDomain,
                domainLength: currentDomain.length,
                domainString: domainString,
                lastDomain: this.filterState.lastDomain,
                hasChanged: this.filterState.lastDomain !== domainString,
                timestamp: new Date().toLocaleTimeString()
            });
            
            // Vérifier si le domaine a changé
            if (this.filterState.lastDomain !== domainString) {
                // console.log('🔍 SEARCH: Changement détecté dans les filtres de recherche:', {
                //     domain: currentDomain,
                //     length: currentDomain.length,
                //     isEmpty: currentDomain.length === 0,
                //     previousLength: this.filterState.lastDomain ? JSON.parse(this.filterState.lastDomain).length : 'N/A'
                // });
                
                this.filterState.lastDomain = domainString;
                
                // Informer le dashboard même si le domaine est vide (pour réinitialiser)
                this.notifyDashboardOfSearchChange(currentDomain);
            } else {
                // console.log('🔍 SEARCH: Aucun changement détecté - ignorer');
            }
            
            // Débloquer après un délai
            setTimeout(() => {
                this.filterState.isHandlingSearch = false;
                // console.log('🔓 SEARCH: Flag de traitement réinitialisé');
            }, 300);
            
        } catch (error) {
            // console.error('❌ SEARCH: Erreur détection changement filtres:', error);
            this.filterState.isHandlingSearch = false;
        }
    }
    
    notifyDashboardOfSearchChange(searchDomain) {
        try {
            // console.log('📢 SEARCH: Notification dashboard du changement (améliorée):', {
            //     domain: searchDomain,
            //     length: searchDomain.length,
            //     isEmpty: !searchDomain || searchDomain.length === 0
            // });
            
            // Extraire les filtres pertinents pour le dashboard
            const dashboardFilters = this.extractDashboardFilters(searchDomain);
            
            // Vérifier si tous les filtres sont vides (réinitialisation complète)
            const hasAnyActiveFilter = Object.values(dashboardFilters).some(value => {
                if (Array.isArray(value)) return value.length > 0;
                if (value === null || value === undefined) return false;
                if (typeof value === 'object') return Object.keys(value).length > 0;
                if (typeof value === 'string') return value.trim().length > 0;
                return true;
            });
            
            // NOUVEAU: Si on a une recherche générale, s'assurer qu'elle est bien prise en compte
            if (dashboardFilters.generalSearch && dashboardFilters.generalSearch.trim().length > 0) {
                // console.log('✅ SEARCH: Recherche textuelle détectée et confirmée:', dashboardFilters.generalSearch);
            }
            
            // console.log('🎯 SEARCH: Filtres extraits pour dashboard:', {
            //     filters: dashboardFilters,
            //     hasActiveFilters: hasAnyActiveFilter,
            //     isCompleteReset: !hasAnyActiveFilter && searchDomain.length === 0
            // });
            
            // IMPORTANT: Toujours notifier le dashboard - même pour les réinitialisations
            const eventData = {
                ...dashboardFilters,
                searchDomain: searchDomain,
                timestamp: Date.now(),
                source: 'search',
                isCompleteReset: !hasAnyActiveFilter && searchDomain.length === 0
            };
            
            // console.log('📡 SEARCH: Émission événement vers dashboard (incluant reset):', eventData);
            
            // Émettre l'événement pour le dashboard
            const event = new CustomEvent('search-filter-changed', {
                detail: eventData
            });
            
            if (typeof window !== 'undefined') {
                window.dispatchEvent(event);
                // console.log('🌍 SEARCH: Événement émis via window');
            }
            
            if (this.env.bus) {
                this.env.bus.trigger('search-filter-changed', eventData);
                // console.log('🚌 SEARCH: Événement émis via bus');
            }
            
        } catch (error) {
            // console.error('❌ SEARCH: Erreur notification dashboard:', error);
        }
    }
    
    extractDashboardFilters(searchDomain) {
        const filters = {
            caisseIds: null,
            monthId: null,
            projectIds: null,
            dateRange: null,
            userIds: null,
            expenseType: null,
            validationStatus: null,
            hasAttachments: null,
            amountCondition: null,
            generalSearch: null
        };
        
        try {
            // console.log('🔍 EXTRACT: Analyse COMPLETE du domaine search:', searchDomain);
            
            // AJOUT TEMPORAIRE DE DEBUG pour identifier le problème de recherche
            console.log('🔍 DEBUG EXTRACT: Analyse domaine search:', {
                searchDomain: searchDomain,
                length: searchDomain.length,
                timestamp: new Date().toLocaleTimeString()
            });
            
            // NOUVEAU: Gestion des domaines de recherche complexes avec OR
            // Odoo génère parfois des domaines comme ['|', ['name','ilike','text'], ['description','ilike','text']]
            let flattenedDomain = [];
            for (let i = 0; i < searchDomain.length; i++) {
                const item = searchDomain[i];
                if (item === '|' || item === '&') {
                    // Opérateur logique - continuer
                    continue;
                } else if (Array.isArray(item) && item.length >= 3) {
                    flattenedDomain.push(item);
                } else {
                    // Autre type d'élément - l'ajouter tel quel
                    flattenedDomain.push(item);
                }
            }
            
            // console.log('🔍 EXTRACT: Domaine aplati:', flattenedDomain);
            
            // AJOUT DEBUG: Analyser chaque élément du domaine aplati
            console.log('🔍 DEBUG EXTRACT: Domaine aplati détaillé:');
            flattenedDomain.forEach((item, index) => {
                console.log(`  [${index}]:`, typeof item, item);
            });
            
            // Parcourir le domaine pour extraire TOUS les filtres pertinents
            for (const condition of flattenedDomain) {
                // NOUVEAU: Gestion des Proxy d'Odoo - conversion en array normal
                let actualCondition = condition;
                if (condition && typeof condition === 'object' && condition.constructor && condition.constructor.name === 'Array') {
                    // C'est probablement un Proxy Array, convertir en array normal
                    actualCondition = Array.from(condition);
                    console.log('✅ EXTRACT: Conversion Proxy en Array:', actualCondition);
                }
                
                // NOUVEAU: Gestion des chaînes simples (comme "Project 2 - Demo")
                if (typeof actualCondition === 'string' && actualCondition.length > 0) {
                    // C'est probablement une recherche textuelle
                    filters.generalSearch = actualCondition;
                    console.log('✅ EXTRACT: Recherche textuelle simple détectée:', actualCondition);
                    continue;
                }
                
                // NOUVEAU: Gestion des arrays avec un seul élément string (comme ["Project 2 - Demo"])
                if (Array.isArray(actualCondition) && actualCondition.length === 1 && typeof actualCondition[0] === 'string' && actualCondition[0].length > 0) {
                    // C'est probablement une recherche textuelle dans un array
                    filters.generalSearch = actualCondition[0];
                    console.log('✅ EXTRACT: Recherche textuelle en array détectée:', actualCondition[0]);
                    continue;
                }
                
                // NOUVEAU: Vérification spécifique pour les domaines de recherche Odoo mal formatés
                if (Array.isArray(actualCondition) && actualCondition.length === 1 && actualCondition[0] && typeof actualCondition[0] === 'string') {
                    filters.generalSearch = actualCondition[0];
                    console.log('✅ EXTRACT: Recherche Odoo format spécial détectée:', actualCondition[0]);
                    continue;
                }
                
                if (Array.isArray(actualCondition) && actualCondition.length >= 3) {
                    const [field, operator, value, ...extraValues] = actualCondition;
                    
                    // console.log('🔍 EXTRACT: Condition analysée:', { field, operator, value, type: typeof value });
                    
                    // NOUVEAU: Vérifier s'il y a des valeurs supplémentaires (recherche textuelle)
                    if (extraValues && extraValues.length > 0) {
                        // Il y a des valeurs supplémentaires, probablement une recherche
                        const searchText = extraValues.find(val => typeof val === 'string' && val.length > 0);
                        if (searchText) {
                            filters.generalSearch = searchText;
                            console.log('✅ EXTRACT: Recherche textuelle dans condition complexe détectée:', searchText);
                        }
                    }
                    
                    // NOUVEAU: Vérification directe pour le 4ème élément
                    if (actualCondition.length === 4 && typeof actualCondition[3] === 'string' && actualCondition[3].length > 0) {
                        filters.generalSearch = actualCondition[3];
                        console.log('✅ EXTRACT: Recherche 4ème élément détectée:', actualCondition[3]);
                    }
                    
                    // 1. Filtres de caisse - toutes les variantes possibles (AMÉLIORÉ)
                    if (field === 'expense_account_id') {
                        if (operator === 'in' && Array.isArray(value)) {
                            filters.caisseIds = value;
                            // console.log('✅ EXTRACT: Filtre caisse IN trouvé:', value);
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.caisseIds = [value];
                            // console.log('✅ EXTRACT: Filtre caisse = trouvé:', value);
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            // console.log('⚠️ EXTRACT: Recherche par nom caisse:', value);
                            filters.generalSearch = value;
                        } else if (operator === '=' && typeof value === 'string') {
                            // NOUVEAU: Gestion des recherches par nom de caisse avec format "Nom - Manager"
                            filters.generalSearch = value;
                            console.log('✅ EXTRACT: Recherche caisse par nom complet:', value);
                        }
                    }
                    
                    // 1bis. Recherche par nom de caisse via display_name - NOUVEAU
                    else if (field === 'expense_account_id.name' && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                        // console.log('✅ EXTRACT: Recherche par nom caisse via display_name:', value);
                    }
                    
                    // 2. Filtres de projet - TOUTES les variantes (AMÉLIORÉ)
                    else if (field === 'project_id') {
                        if (operator === 'in' && Array.isArray(value)) {
                            filters.projectIds = value;
                            // console.log('✅ EXTRACT: Filtre projet IN trouvé:', value);
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.projectIds = [value];
                            // console.log('✅ EXTRACT: Filtre projet = trouvé:', value);
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            // Recherche par nom de projet - on le traite comme un filtre projet ET recherche générale
                            filters.generalSearch = value;
                            // console.log('⚠️ EXTRACT: Recherche par nom projet:', value);
                        } else if (operator !== false && value) {
                            // Autres opérateurs pour projet
                            // console.log('✅ EXTRACT: Filtre projet autre opérateur:', { operator, value });
                            if (typeof value === 'number') {
                                filters.projectIds = [value];
                            } else if (Array.isArray(value)) {
                                filters.projectIds = value;
                            }
                        }
                    }
                    
                    // 2bis. Recherche par nom de projet via display_name - NOUVEAU
                    else if (field === 'project_id.name' && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                        // console.log('✅ EXTRACT: Recherche par nom projet via display_name:', value);
                    }
                    
                    // 3. Filtres d'utilisateur - TOUTES les variantes
                    else if (field === 'user_id') {
                        if (operator === 'in' && Array.isArray(value)) {
                            filters.userIds = value;
                            // console.log('✅ EXTRACT: Filtre utilisateur IN trouvé:', value);
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.userIds = [value];
                            // console.log('✅ EXTRACT: Filtre utilisateur = trouvé:', value);
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            // console.log('⚠️ EXTRACT: Recherche par nom utilisateur:', value);
                            filters.generalSearch = value;
                        }
                    }
                    
                    // 4. Filtres de type de dépense - TOUTES les variantes
                    else if (field === 'expense_move_type') {
                        if (operator === '=' && typeof value === 'string') {
                            filters.expenseType = value;
                            // console.log('✅ EXTRACT: Filtre type dépense trouvé:', value);
                        } else if (operator === 'in' && Array.isArray(value)) {
                            filters.expenseType = value[0]; // Prendre le premier
                            // console.log('✅ EXTRACT: Filtre type dépense IN trouvé:', value);
                        }
                    }
                    
                    // 4bis. Filtres de validation - NOUVEAU
                    else if (field === 'validate_by_administrator') {
                        filters.validationStatus = value;
                        // console.log('✅ EXTRACT: Filtre validation trouvé:', value);
                    }
                    
                    // 4ter. Filtres de pièces jointes - NOUVEAU 
                    else if (field === 'attachment_ids') {
                        if (operator === '!=' && value === false) {
                            filters.hasAttachments = true;
                            // console.log('✅ EXTRACT: Filtre avec pièces jointes trouvé');
                        } else if (operator === '=' && value === false) {
                            filters.hasAttachments = false;
                            // console.log('✅ EXTRACT: Filtre sans pièces jointes trouvé');
                        }
                    }
                    
                    // 4quater. Filtres de montant - NOUVEAU
                    else if (field === 'total_amount') {
                        if (operator === '>' && typeof value === 'number') {
                            filters.amountCondition = { operator: '>', value: value };
                            // console.log('✅ EXTRACT: Filtre montant > trouvé:', value);
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.amountCondition = { operator: '=', value: value };
                            // console.log('✅ EXTRACT: Filtre montant = trouvé:', value);
                        } else if (operator === '<' && typeof value === 'number') {
                            filters.amountCondition = { operator: '<', value: value };
                            // console.log('✅ EXTRACT: Filtre montant < trouvé:', value);
                        }
                    }
                    
                    // 5. Filtres de mois
                    else if (field === 'caisse_mois_id') {
                        if (operator === '=' && typeof value === 'number') {
                            filters.monthId = value;
                            // console.log('✅ EXTRACT: Filtre mois trouvé:', value);
                        } else if (operator === 'in' && Array.isArray(value) && value.length === 1) {
                            filters.monthId = value[0];
                            // console.log('✅ EXTRACT: Filtre mois IN trouvé:', value[0]);
                        }
                    }
                    
                    // 6. Filtres de date - TOUTES les variantes
                    else if (field === 'date') {
                        if (operator === '>=' || operator === '>' || operator === '<=' || operator === '<') {
                            if (!filters.dateRange) filters.dateRange = {};
                            if (operator === '>=' || operator === '>') {
                                filters.dateRange.start = value;
                            } else {
                                filters.dateRange.end = value;
                            }
                            // console.log('✅ EXTRACT: Filtre date trouvé:', { operator, value });
                        } else if (operator === '=' && typeof value === 'string') {
                            filters.dateRange = { start: value, end: value };
                            // console.log('✅ EXTRACT: Filtre date exacte trouvé:', value);
                        }
                    }
                    
                    // 7. Recherche générale - CAPTURE TOUT (AMÉLIORÉ)
                    else if (field === 'name' && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                        // console.log('✅ EXTRACT: Recherche générale par nom:', value);
                    }
                    
                    // 7bis. Autres recherches textuelles - NOUVEAU
                    else if ((field === 'project_manager_id' || field === 'expense_account_id' || field === 'description') 
                             && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                        // console.log('✅ EXTRACT: Recherche textuelle sur', field, ':', value);
                    }
                    
                    // 7ter. Gestion des domaines complexes de recherche Odoo - NOUVEAU
                    else if (operator === 'ilike' && typeof value === 'string' && value.length > 0) {
                        // Capturer toute recherche ilike comme recherche générale
                        filters.generalSearch = value;
                        // console.log('✅ EXTRACT: Recherche ilike générique sur', field, ':', value);
                    }
                    
                    // 8. Autres champs potentiels
                    else if (value !== false && value !== null && value !== undefined) {
                        // console.log('⚠️ EXTRACT: Champ non géré détecté:', { field, operator, value });
                    }
                }
            }
            
            // Résumé des filtres extraits
            const activeFiltersCount = Object.values(filters).filter(v => v !== null).length;
            // console.log('✅ EXTRACT: RESUME - Filtres extraits (' + activeFiltersCount + ' actifs):', filters);
            
        } catch (error) {
            // console.error('❌ EXTRACT: Erreur extraction filtres:', error);
        }
        
        return filters;
    }
}

// Enregistrement de la vue
registry.category('views').add('expense_spending_dashboard_tree', {
    ...listView,
    Renderer: ExpenseDashboardListRenderer,
    Controller: ExpenseDashboardListController,
});

// console.log('✅ Vue avec renderer et controller synchronisés enregistrés');

// Debug: vérifier l'enregistrement
setTimeout(() => {
    const registered = registry.category('views').get('expense_spending_dashboard_tree', null);
    if (registered) {
        // console.log('✅ REGISTER: Vue correctement enregistrée dans le registre');
    } else {
        // console.error('❌ REGISTER: Échec enregistrement de la vue');
    }
}, 100);
