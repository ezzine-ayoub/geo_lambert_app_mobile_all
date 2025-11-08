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
        
        // Vérifier si c'est notre modèle spécifique
        this.showExpenseDashboard = this.props.list?.resModel === 'hr.expense.account.move';
        
        if (this.showExpenseDashboard) {
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
            
            onWillUnmount(() => {
                // L'observateur DOM sera nettoyé par le controller
            });
        }
    }
    
    setupFilterSynchronization() {
        console.log('🔌 RENDERER: Configuration synchronisation filtres');
        
        // Écouter les événements du dashboard via window
        if (typeof window !== 'undefined') {
            const handleDashboardFilterChange = (event) => {
                console.log('📡 RENDERER: Événement reçu du dashboard:', event.detail);
                this.notifyControllerOfFilterChange(event.detail);
            };
            
            window.addEventListener('dashboard-filter-changed', handleDashboardFilterChange);
            
            // Nettoyer l'écouteur lors du démontage
            this._dashboardFilterListener = handleDashboardFilterChange;
        }
    }
    
    notifyControllerOfFilterChange(filterData) {
        try {
            console.log('📢 RENDERER: Notification du controller avec:', filterData);
            
            // Notifier le controller via un événément custom
            if (typeof window !== 'undefined') {
                const event = new CustomEvent('renderer-apply-dashboard-filter', {
                    detail: filterData
                });
                window.dispatchEvent(event);
            }
        } catch (error) {
            console.error('❌ RENDERER: Erreur notification controller:', error);
        }
    }
}

export class ExpenseDashboardListController extends ListController {
    setup() {
        super.setup();
        this.notification = useService('notification');
        
        // État pour détecter les changements de filtres
        this.filterState = useState({
            lastDomain: null,
            isHandlingSearch: false,
            lastCheck: Date.now(),
            pendingRefresh: false,
            isApplyingDashboardFilter: false
        });
        
        // Écouter les événements du renderer
        if (typeof window !== 'undefined') {
            window.addEventListener('renderer-filter-change-detected', () => {
                this.handleSearchFilterChange();
            });
            
            // Écouter les filtres du dashboard
            window.addEventListener('renderer-apply-dashboard-filter', (event) => {
                console.log('📡 CONTROLLER: Reçu filtre dashboard du renderer:', event.detail);
                this.applyDashboardFilter(event.detail);
            });
        }
        
        // Configurer l'observateur DOM
        this.setupDOMObserver();
        
        // Polling périodique
        this.setupPeriodicCheck();

        console.log('✅ CONTROLLER: Initialisé');
    }
    
    async applyDashboardFilter(filterData) {
        try {
            if (!filterData || this.filterState.isApplyingDashboardFilter) {
                console.log('⏳ CONTROLLER: Application filtre ignorée (en cours ou vide)');
                return;
            }
            
            console.log('🔄 CONTROLLER: Application filtre dashboard:', filterData);
            
            this.filterState.isApplyingDashboardFilter = true;
            
            const searchDomain = filterData.domain || [];
            
            console.log('🎯 CONTROLLER: Domaine à appliquer:', searchDomain);
            
            // Méthode principale: Recharger via le modèle
            if (this.model && this.model.root) {
                try {
                    console.log('🔄 CONTROLLER: Rechargement du modèle...');
                    
                    // Mettre à jour le domaine
                    await this.model.root.load({
                        domain: searchDomain,
                        context: this.model.root.context || {},
                    });
                    
                    // Mettre à jour lastDomain pour éviter la détection de changement
                    this.filterState.lastDomain = JSON.stringify(searchDomain);
                    
                    console.log('✅ CONTROLLER: Modèle rechargé avec succès');
                    console.log('📊 CONTROLLER: Nombre de lignes:', this.model.root.records.length);
                } catch (modelError) {
                    console.error('❌ CONTROLLER: Erreur rechargement modèle:', modelError);
                }
            } else {
                console.warn('⚠️ CONTROLLER: Modèle non disponible');
            }
            
        } catch (error) {
            console.error('❌ CONTROLLER: Erreur application filtre dashboard:', error);
        } finally {
            setTimeout(() => {
                this.filterState.isApplyingDashboardFilter = false;
                console.log('🔓 CONTROLLER: Verrou libéré');
            }, 1000);
        }
    }
    
    setupPeriodicCheck() {
        this.periodicInterval = setInterval(() => {
            try {
                const currentDomain = this.model?.root?.domain || [];
                const domainString = JSON.stringify(currentDomain);
                
                if (this.filterState.lastDomain !== domainString) {
                    this.filterState.lastDomain = domainString;
                    this.notifyDashboardOfSearchChange(currentDomain);
                }
            } catch (error) {
                console.error('❌ PERIODIC: Erreur vérification périodique:', error);
            }
        }, 500);
    }
    
    willDestroy() {
        super.willDestroy?.();
        
        if (this.domObserver) {
            this.domObserver.disconnect();
        }
        
        if (this.periodicInterval) {
            clearInterval(this.periodicInterval);
        }

        console.log('🧹 CONTROLLER: Nettoyé');
    }
    
    setupDOMObserver() {
        try {
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
                        mutation.removedNodes.forEach(node => {
                            if (node.nodeType === 1 && 
                                (node.classList?.contains('o_searchview_facet') ||
                                 node.querySelector?.('.o_searchview_facet'))) {
                                shouldCheck = true;
                                isFilterRemoval = true;
                            }
                        });
                        
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && 
                                (node.classList?.contains('o_searchview_facet') ||
                                 node.querySelector?.('.o_searchview_facet'))) {
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
                    if (isFilterRemoval) {
                        setTimeout(() => this.forceFilterDetection(), 100);
                    } else {
                        setTimeout(() => this.handleSearchFilterChange(), 300);
                    }
                }
            };
            
            this.domObserver = new MutationObserver(callback);
            
            if (typeof document !== 'undefined') {
                this.domObserver.observe(document.body, observerConfig);
            }
            
        } catch (error) {
            console.error('❌ DOM: Erreur configuration observateur:', error);
        }
    }

    async onUpdatedPaging() {
        const result = await super.onUpdatedPaging();
        await this.handleSearchFilterChangeAsync();
        return result;
    }
    
    async onActiveElementsChanged() {
        const result = await super.onActiveElementsChanged?.();
        await this.handleSearchFilterChangeAsync();
        return result;
    }
    
    async load() {
        console.log('🔄 CONTROLLER: Load appelé');
        const result = await super.load();
        await this.handleSearchFilterChangeAsync();
        return result;
    }
    
    async search(searchValue, { reload = true } = {}) {
        console.log('🔍 CONTROLLER: Search appelé:', searchValue);
        const result = await super.search?.(searchValue, { reload });
        await this.handleSearchFilterChangeAsync();
        return result;
    }
    
    async update(params) {
        console.log('🔄 CONTROLLER: Update appelé');
        const result = await super.update(params);
        await this.handleSearchFilterChangeAsync();
        return result;
    }
    
    async reload(params) {
        console.log('🔄 CONTROLLER: Reload appelé');
        this.filterState.pendingRefresh = true;
        
        try {
            const result = await super.reload(params);
            
            // Attendre que le render soit terminé
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // Déclencher la mise à jour du dashboard
            await this.handleSearchFilterChangeAsync();
            
            return result;
        } finally {
            this.filterState.pendingRefresh = false;
        }
    }
    
    forceFilterDetection() {
        this.filterState.lastDomain = null;
        this.handleSearchFilterChange();
    }

    async handleSearchFilterChangeAsync() {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.handleSearchFilterChange();
                resolve();
            }, 100);
        });
    }
    
    handleSearchFilterChange() {
        try {
            if (this.filterState.isHandlingSearch || this.filterState.isApplyingDashboardFilter) {
                console.log('⏳ CONTROLLER: Déjà en traitement ou application dashboard, skip');
                return;
            }
            
            this.filterState.isHandlingSearch = true;
            
            const currentDomain = this.model?.root?.domain || [];
            const domainString = JSON.stringify(currentDomain);
            
            console.log('🔍 CONTROLLER: Vérification domain:', {
                currentLength: currentDomain.length,
                changed: this.filterState.lastDomain !== domainString
            });
            
            if (this.filterState.lastDomain !== domainString) {
                this.filterState.lastDomain = domainString;
                this.notifyDashboardOfSearchChange(currentDomain);
            }
            
            setTimeout(() => {
                this.filterState.isHandlingSearch = false;
            }, 300);
            
        } catch (error) {
            console.error('❌ CONTROLLER: Erreur détection changement filtres:', error);
            this.filterState.isHandlingSearch = false;
        }
    }
    
    notifyDashboardOfSearchChange(searchDomain) {
        try {
            console.log('📢 CONTROLLER: Notification dashboard du changement:', {
                domain: searchDomain,
                length: searchDomain.length,
                isEmpty: !searchDomain || searchDomain.length === 0
            });
            
            const dashboardFilters = this.extractDashboardFilters(searchDomain);
            
            const hasAnyActiveFilter = Object.values(dashboardFilters).some(value => {
                if (Array.isArray(value)) return value.length > 0;
                if (value === null || value === undefined) return false;
                if (typeof value === 'object') return Object.keys(value).length > 0;
                if (typeof value === 'string') return value.trim().length > 0;
                return true;
            });
            
            console.log('🎯 CONTROLLER: Filtres extraits:', {
                filters: dashboardFilters,
                hasActiveFilters: hasAnyActiveFilter
            });
            
            const eventData = {
                ...dashboardFilters,
                searchDomain: searchDomain,
                timestamp: Date.now(),
                source: 'search',
                isCompleteReset: !hasAnyActiveFilter && searchDomain.length === 0
            };
            
            console.log('📡 CONTROLLER: Émission événement vers dashboard');
            
            const event = new CustomEvent('search-filter-changed', {
                detail: eventData
            });
            
            if (typeof window !== 'undefined') {
                window.dispatchEvent(event);
            }
            
            if (this.env.bus) {
                this.env.bus.trigger('search-filter-changed', eventData);
            }
            
        } catch (error) {
            console.error('❌ CONTROLLER: Erreur notification dashboard:', error);
        }
    }
    
    extractDashboardFilters(searchDomain) {
        const filters = {
            caisseIds: null,
            monthId: null,
            projectIds: null,
            dateRange: null,
            userIds: null,
            employeeIds: null,
            expenseType: null,
            validationStatus: null,
            hasAttachments: null,
            amountCondition: null,
            generalSearch: null
        };
        
        try {
            console.log('🔍 EXTRACT: Analyse domaine search:', searchDomain);
            
            // Aplatir le domaine (gérer les opérateurs OR/AND)
            let flattenedDomain = [];
            for (let i = 0; i < searchDomain.length; i++) {
                const item = searchDomain[i];
                if (item === '|' || item === '&') {
                    continue;
                } else if (Array.isArray(item) && item.length >= 3) {
                    flattenedDomain.push(item);
                } else {
                    flattenedDomain.push(item);
                }
            }
            
            console.log('🔍 EXTRACT: Domaine aplati:', flattenedDomain);
            
            // Parcourir le domaine
            for (const condition of flattenedDomain) {
                let actualCondition = condition;
                
                // Conversion Proxy en Array
                if (condition && typeof condition === 'object' && condition.constructor && condition.constructor.name === 'Array') {
                    actualCondition = Array.from(condition);
                }
                
                // Gestion des chaînes simples
                if (typeof actualCondition === 'string' && actualCondition.length > 0) {
                    filters.generalSearch = actualCondition;
                    console.log('✅ EXTRACT: Recherche textuelle simple:', actualCondition);
                    continue;
                }
                
                // Gestion des arrays avec un seul élément string
                if (Array.isArray(actualCondition) && actualCondition.length === 1 && typeof actualCondition[0] === 'string' && actualCondition[0].length > 0) {
                    filters.generalSearch = actualCondition[0];
                    console.log('✅ EXTRACT: Recherche textuelle en array:', actualCondition[0]);
                    continue;
                }
                
                if (Array.isArray(actualCondition) && actualCondition.length >= 3) {
                    const [field, operator, value] = actualCondition;
                    
                    console.log('🔍 EXTRACT: Analyse condition:', { field, operator, value, type: typeof value });
                    
                    // FILTRES DE CAISSE
                    if (field === 'expense_account_id') {
                        if (operator === 'in' && Array.isArray(value) && value.length > 0) {
                            if (value.every(v => typeof v === 'number')) {
                                filters.caisseIds = value;
                                console.log('✅ EXTRACT CAISSE: IDs numériques:', value);
                            } else {
                                const numericIds = value.filter(v => typeof v === 'number' || !isNaN(parseInt(v))).map(v => typeof v === 'number' ? v : parseInt(v));
                                if (numericIds.length > 0) {
                                    filters.caisseIds = numericIds;
                                    console.log('✅ EXTRACT CAISSE: IDs convertis:', numericIds);
                                } else {
                                    filters.generalSearch = value.join(' ');
                                }
                            }
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.caisseIds = [value];
                            console.log('✅ EXTRACT CAISSE: ID unique:', value);
                        } else if (operator === '=' && typeof value === 'string' && !isNaN(parseInt(value))) {
                            filters.caisseIds = [parseInt(value)];
                            console.log('✅ EXTRACT CAISSE: ID converti:', parseInt(value));
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            filters.generalSearch = value;
                            console.log('✅ EXTRACT CAISSE: Recherche par nom:', value);
                        } else if (operator === '=' && typeof value === 'string') {
                            filters.generalSearch = value;
                            console.log('✅ EXTRACT CAISSE: Recherche par display_name:', value);
                        }
                    }
                    else if (field === 'expense_account_id.name' && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                        console.log('✅ EXTRACT CAISSE: Recherche via display_name:', value);
                    }
                    
                    // FILTRES D'EMPLOYÉ
                    else if (field === 'employee_id') {
                        if (operator === 'in' && Array.isArray(value) && value.every(v => typeof v === 'number')) {
                            filters.employeeIds = value;
                            console.log('✅ EXTRACT EMPLOYEE: IDs:', value);
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.employeeIds = [value];
                            console.log('✅ EXTRACT EMPLOYEE: ID unique:', value);
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            filters.generalSearch = value;
                            console.log('✅ EXTRACT EMPLOYEE: Recherche par nom:', value);
                        } else if (operator === '=' && typeof value === 'string') {
                            filters.generalSearch = value;
                        }
                    }
                    
                    // AUTRES FILTRES
                    else if (field === 'project_id') {
                        if (operator === 'in' && Array.isArray(value)) {
                            filters.projectIds = value;
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.projectIds = [value];
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            filters.generalSearch = value;
                        }
                    }
                    else if (field === 'user_id') {
                        if (operator === 'in' && Array.isArray(value)) {
                            filters.userIds = value;
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.userIds = [value];
                        } else if (operator === 'ilike' && typeof value === 'string') {
                            filters.generalSearch = value;
                        }
                    }
                    else if (field === 'expense_move_type') {
                        if (operator === '=' && typeof value === 'string') {
                            filters.expenseType = value;
                        } else if (operator === 'in' && Array.isArray(value)) {
                            filters.expenseType = value[0];
                        }
                    }
                    else if (field === 'validate_by_administrator') {
                        filters.validationStatus = value;
                    }
                    else if (field === 'attachment_ids') {
                        if (operator === '!=' && value === false) {
                            filters.hasAttachments = true;
                        } else if (operator === '=' && value === false) {
                            filters.hasAttachments = false;
                        }
                    }
                    else if (field === 'total_amount') {
                        if (operator === '>' && typeof value === 'number') {
                            filters.amountCondition = { operator: '>', value: value };
                        } else if (operator === '=' && typeof value === 'number') {
                            filters.amountCondition = { operator: '=', value: value };
                        } else if (operator === '<' && typeof value === 'number') {
                            filters.amountCondition = { operator: '<', value: value };
                        }
                    }
                    else if (field === 'caisse_mois_id') {
                        if (operator === '=' && typeof value === 'number') {
                            filters.monthId = value;
                        } else if (operator === 'in' && Array.isArray(value) && value.length === 1) {
                            filters.monthId = value[0];
                        }
                    }
                    else if (field === 'date') {
                        if (operator === '>=' || operator === '>' || operator === '<=' || operator === '<') {
                            if (!filters.dateRange) filters.dateRange = {};
                            if (operator === '>=' || operator === '>') {
                                filters.dateRange.start = value;
                            } else {
                                filters.dateRange.end = value;
                            }
                        } else if (operator === '=' && typeof value === 'string') {
                            filters.dateRange = { start: value, end: value };
                        }
                    }
                    else if (field === 'name' && operator === 'ilike' && typeof value === 'string') {
                        filters.generalSearch = value;
                    }
                    else if (operator === 'ilike' && typeof value === 'string' && value.length > 0) {
                        filters.generalSearch = value;
                        console.log('✅ EXTRACT: Recherche ilike générique sur', field, ':', value);
                    }
                }
            }
            
            const activeFiltersCount = Object.values(filters).filter(v => v !== null).length;
            console.log('✅ EXTRACT: Filtres extraits (' + activeFiltersCount + ' actifs):', filters);
            
        } catch (error) {
            console.error('❌ EXTRACT: Erreur extraction filtres:', error);
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

console.log('✅ Vue expense_spending_dashboard_tree enregistrée');
