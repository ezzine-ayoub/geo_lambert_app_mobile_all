/** @odoo-module */
import { useService } from '@web/core/utils/hooks';
import { registry } from "@web/core/registry";
import { session } from '@web/session';
import { formatCurrency } from '@web/core/utils/numbers';
import { Component, onWillStart, useState } from "@odoo/owl";

function formatMonetaryWithSpaces(value, currency_id = 1) {
    try {
        if (!value && value !== 0) value = 0;

        // Utiliser l'API Odoo 18 pour le formatage monétaire
        try {
            return formatCurrency(value, currency_id);
        } catch (formatError) {
            // console.warn('Erreur formatCurrency:', formatError);

            // Fallback avec formatage manuel
            const formattedValue = new Intl.NumberFormat('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);

            // Essayer d'accéder aux devises via session.currencies
            if (session.currencies && session.currencies[currency_id]) {
                const currency = session.currencies[currency_id];
                if (currency.position === "after") {
                    return formattedValue + " " + currency.symbol;
                } else {
                    return currency.symbol + " " + formattedValue;
                }
            }

            return formattedValue + " DH";
        }
    } catch (error) {
        // console.warn('Erreur formatage monétaire:', error);
        return (value || 0).toFixed(2) + " DH";
    }
}

export class ExpenseDashboard extends Component {
    static template = 'hr_expense_caisse.ExpenseDashboard';
    static props = {
        domain: { type: Array, optional: true },
    };

    setup() {
        super.setup();
        this.orm = useService('orm');
        this.notification = useService('notification');

        // État initial avec valeurs par défaut sécurisées
        this.state = useState({
            loading: false, // CORRECTION: Commencer sans loading pour éviter le flash
            dataReady: true, // CORRECTION: Marquer comme prêt dès le début
            selectedCaisses: [],
            allCaisses: [],
            selectedMonth: null,
            selectedDate: null,
            selectedEmployee: null,
            allEmployees: [],
            allMonths: [],
            selectedMonthDetails: null,
            totalBalance: 0,
            totalExpenses: 0,
            totalReplenishments: 0,
            expenseMovements: [],
            filteredCount: undefined
        });
        
        // Flag pour éviter les boucles infinies lors de l'auto-sélection
        this.isAutoSelecting = false;

        onWillStart(async () => {
            // Charger les filtres depuis l'URL avant de charger les données
            await this.loadFiltersFromURL();
            await this.loadDashboardData();

            // Configurer l'écoute des changements de filtres de recherche
            this.setupSearchFilterListener();

            // Référence globale pour debug
            if (typeof window !== 'undefined') {
                window.expenseDashboard = this;
            }
        });
    }

    async loadFiltersFromURL() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);
                const caisseFilter = url.searchParams.get('caisse_filter');
                const monthFilter = url.searchParams.get('month_filter');
                const employeeFilter = url.searchParams.get('employee_filter');
                const isDashboardFiltered = url.searchParams.get('dashboard_filtered');

                if (isDashboardFiltered) {
                    if (caisseFilter) {
                        const caisseIds = caisseFilter.split(',').map(id => parseInt(id));
                        this.state.selectedCaisses = caisseIds;
                    }

                    if (monthFilter) {
                        this.state.selectedMonth = parseInt(monthFilter);
                    }

                    if (employeeFilter) {
                        this.state.selectedEmployee = parseInt(employeeFilter);
                    }
                }
            }
        } catch (error) {
            // console.error('❌ Erreur chargement filtres depuis URL:', error);
        }
    }

    async loadDashboardData() {
        try {

            // 1. Charger les caisses avec gestion d'erreur
            await this.loadCaisses();

            // 2. Charger les employés avec gestion d'erreur
            await this.loadEmployees();

            // 3. Charger les mois avec gestion d'erreur
            await this.loadMonths();

            // 4. Charger les mouvements avec gestion d'erreur
            await this.loadExpenseMovements();

            // 5. Calculer les statistiques
            this.calculateStats();

            // CORRECTION: Les données restent visibles pendant le rechargement

            // 6. Émettre l'événement de filtre après le chargement
            // pour synchroniser la vue tree avec les filtres actuels
            setTimeout(() => this.emitFilterChangeEvent(), 100);

        } catch (error) {
            // console.error('❌ Erreur chargement global:', error);

            if (this.notification) {
                this.notification.add('Erreur lors du chargement des données', { type: 'danger' });
            }
        }
    }

    async loadCaisses() {
        try {
            const all_caisses = await this.orm.call("hr.expense.account", 'search_read', [[]], {
                fields: ['id', 'name', 'type', 'balance', 'user_id']
            });

            this.state.allCaisses = Array.isArray(all_caisses) ? all_caisses : [];

        } catch (error) {
            // console.error('❌ Erreur chargement caisses:', error);
            this.state.allCaisses = [];
        }
    }

    async loadEmployees() {
        try {
            const all_employees = await this.orm.call("hr.employee", 'search_read', [[]], {
                fields: ['id', 'name'],
                order: 'name asc'
            });

            this.state.allEmployees = Array.isArray(all_employees) ? all_employees : [];

        } catch (error) {
            // console.error('❌ Erreur chargement employés:', error);
            this.state.allEmployees = [];
        }
    }

    async loadMonths() {
        try {
            let monthsDomain = [];
            if (this.state.selectedCaisses.length > 0) {
                monthsDomain = [['caisse_id', 'in', this.state.selectedCaisses]];
            }

            const all_months = await this.orm.call("hr.expense.account.month", 'search_read', [monthsDomain], {
                fields: ['id', 'name', 'display_name', 'caisse_id', 'sold', 'solde_initial', 'solde_final'],
                order: 'name desc'
            });

            this.state.allMonths = Array.isArray(all_months) ? all_months : [];

            // Gérer les détails du mois sélectionné
            if (this.state.selectedMonth) {
                const monthDetails = this.state.allMonths.find(m => m.id === this.state.selectedMonth);
                if (monthDetails) {
                    this.state.selectedMonthDetails = monthDetails;
                } else {
                    this.state.selectedMonth = null;
                    this.state.selectedMonthDetails = null;
                }
            }

        } catch (error) {
            // console.error('❌ Erreur chargement mois:', error);
            this.state.allMonths = [];
        }
    }

    async loadExpenseMovements() {
        try {
            let domain = [];


            // فلاتر الكايس
            if (this.state.selectedCaisses.length > 0) {
                domain.push(['expense_account_id', 'in', this.state.selectedCaisses]);
            } else if (this.externalFilters && this.externalFilters.caisseIds && this.externalFilters.caisseIds.length > 0) {
                // Use external filter caisseIds if no internal selection
                domain.push(['expense_account_id', 'in', this.externalFilters.caisseIds]);
            }

            // فلاتر الشهر
            if (this.state.selectedMonth) {
                domain.push(['caisse_mois_id', '=', this.state.selectedMonth]);
            } else if (this.state.selectedDate) {
                // فلتر بالتاريخ إذا لم يكن هناك شهر محدد
                const selectedDate = this.state.selectedDate;
                domain.push(['date', '>=', selectedDate + ' 00:00:00']);
                domain.push(['date', '<=', selectedDate + ' 23:59:59']);
            }

            // فلتر الموظف
            if (this.state.selectedEmployee) {
                domain.push(['employee_id', '=', this.state.selectedEmployee]);
            }


            if (this.externalFilters) {

                if (this.externalFilters.projectIds && this.externalFilters.projectIds.length > 0) {
                    domain.push(['project_id', 'in', this.externalFilters.projectIds]);
                }


                if (this.externalFilters.userIds && this.externalFilters.userIds.length > 0) {
                    domain.push(['user_id', 'in', this.externalFilters.userIds]);
                }


                if (this.externalFilters.projectManagerIds && this.externalFilters.projectManagerIds.length > 0) {
                    domain.push(['project_manager_id', 'in', this.externalFilters.projectManagerIds]);
                }


                if (this.externalFilters.expenseType) {
                    domain.push(['expense_move_type', '=', this.externalFilters.expenseType]);
                }


                if (this.externalFilters.validationStatus !== null && this.externalFilters.validationStatus !== undefined) {
                    domain.push(['validate_by_administrator', '=', this.externalFilters.validationStatus]);
                }


                if (this.externalFilters.hasAttachments === true) {
                    domain.push(['attachment_ids', '!=', false]);
                } else if (this.externalFilters.hasAttachments === false) {
                    domain.push(['attachment_ids', '=', false]);
                }


                if (this.externalFilters.amountCondition) {
                    const { operator, value } = this.externalFilters.amountCondition;
                    domain.push(['total_amount', operator, value]);
                }


                if (this.externalFilters.dateRange) {
                    if (this.externalFilters.dateRange.start) {
                        domain.push(['date', '>=', this.externalFilters.dateRange.start]);
                    }
                    if (this.externalFilters.dateRange.end) {
                        domain.push(['date', '<=', this.externalFilters.dateRange.end]);
                    }
                }

                if (this.externalFilters.generalSearch && this.externalFilters.generalSearch.trim().length > 0) {
                    const searchText = this.externalFilters.generalSearch.trim();


                    const searchConditions = [
                        ['name', 'ilike', searchText],
                        ['description', 'ilike', searchText],
                        ['designation', 'ilike', searchText]
                    ];


                    if (searchText.toLowerCase().includes('caisse') ||
                        searchText.toLowerCase().includes('cash') ||
                        searchText.toLowerCase().includes('demo') ||
                        searchText.toLowerCase().includes('project') ||
                        searchText.toLowerCase().includes('administrator') ||
                        searchText.includes(' - ')) {
                        if (searchText.includes(' - ')) {
                            const parts = searchText.split(' - ');
                            const mainName = parts[0].trim();
                            const managerName = parts[1].trim();

                            searchConditions.push(['expense_account_id', 'ilike', mainName]);

                        } else {
                            searchConditions.push(['expense_account_id', 'ilike', searchText]);
                        }
                    }

                    if (searchText.toLowerCase().includes('admin') ||
                        searchText.toLowerCase().includes('user') ||
                        !searchText.toLowerCase().includes('caisse')) {
                    }

                    if (searchConditions.length === 1) {
                        domain.push(searchConditions[0]);
                    } else if (searchConditions.length > 1) {
                        for (let i = 0; i < searchConditions.length - 1; i++) {
                            domain.push('|');
                        }
                        searchConditions.forEach(condition => {
                            domain.push(condition);
                        });
                    }

                }
            }

            const movements = await this.orm.call("hr.expense.account.move", 'search_read', [domain], {
            });

            this.state.expenseMovements = Array.isArray(movements) ? movements : [];


            this.state.filteredCount = this.state.expenseMovements.length;

        } catch (error) {
            this.state.expenseMovements = [];
            this.state.filteredCount = 0;
        }
    }

    calculateStats() {
        try {
            let totalBalance = 0;
            let totalExpenses = 0;
            let totalReplenishments = 0;


            if (!this.state.expenseMovements || this.state.expenseMovements.length === 0) {
                console.warn('⚠️ STATS: Aucun mouvement à traiter - stats à zéro');
                this.state.totalBalance = 0;
                this.state.totalExpenses = 0;
                this.state.totalReplenishments = 0;
                return;
            }


            this.state.expenseMovements.forEach((movement, index) => {
                if (!movement || typeof movement.total_amount !== 'number') {
                    console.warn(`⚠️ STATS: Mouvement ${index + 1} invalide, ignoré:`, movement);
                    return;
                }

                const movementInfo = {
                    '#': `${index + 1}/${this.state.expenseMovements.length}`,
                    'Ref': movement.name,
                    'Montant': movement.total_amount.toFixed(2) + ' DH',
                    'Type': movement.expense_move_type === 'spent' ? '💸 DÉPENSE' : '💰 ALIMENTATION',
                    'Utilisateur': movement.user_id ? movement.user_id[1] : 'N/A',
                };


                if (movement.expense_move_type === 'spent') {
                    totalExpenses += movement.total_amount;
                } else if (movement.expense_move_type === 'replenish') {
                    totalReplenishments += movement.total_amount;
                } else {
                    console.warn(`⚠️ STATS: Type inconnu pour mouvement ${movement.id}:`, movement.expense_move_type);
                }
            });

            totalBalance = totalReplenishments - totalExpenses;

            this.state.totalBalance = totalBalance;
            this.state.totalExpenses = totalExpenses;
            this.state.totalReplenishments = totalReplenishments;


        } catch (error) {
            console.error('❌ STATS: Erreur calcul statistiques:', error);
            this.state.totalBalance = 0;
            this.state.totalExpenses = 0;
            this.state.totalReplenishments = 0;
        }
    }

    async onCaisseFilterChange(event) {
        try {
            const selectedValue = event.target.value;

            if (selectedValue) {
                this.state.selectedCaisses = [parseInt(selectedValue)];
                
                // Auto-sélectionner l'employé responsable de la caisse (seulement si pas déjà en auto-sélection)
                if (!this.isAutoSelecting) {
                    this.isAutoSelecting = true;
                    
                    const selectedCaisse = this.state.allCaisses.find(c => c.id === parseInt(selectedValue));
                    if (selectedCaisse && selectedCaisse.user_id) {
                        // Récupérer le user_id de la caisse
                        const userId = selectedCaisse.user_id[0];
                        
                        // Trouver l'employé correspondant à ce user_id
                        try {
                            const employees = await this.orm.call("hr.employee", 'search_read', 
                                [[['user_id', '=', userId]]], 
                                { fields: ['id'], limit: 1 }
                            );
                            
                            if (employees && employees.length > 0) {
                                this.state.selectedEmployee = employees[0].id;
                                console.log('✅ CAISSE→EMPLOYÉ: Employé auto-sélectionné:', employees[0].id);
                            } else {
                                // Si pas d'employé trouvé, réinitialiser
                                this.state.selectedEmployee = null;
                                console.log('⚠️ Aucun employé trouvé pour le user_id:', userId);
                            }
                        } catch (employeeError) {
                            console.warn('⚠️ Erreur récupération employé:', employeeError);
                            this.state.selectedEmployee = null;
                        }
                    } else {
                        // Pas de responsable assigné à la caisse
                        this.state.selectedEmployee = null;
                    }
                    
                    // Libérer le flag après un délai
                    setTimeout(() => {
                        this.isAutoSelecting = false;
                    }, 500);
                }
            } else {
                this.state.selectedCaisses = [];
                this.state.selectedEmployee = null;
            }

            this.state.selectedMonth = null;
            this.state.selectedDate = null;
            this.state.selectedMonthDetails = null;

            // Recharger les données du dashboard
            await this.loadDashboardData();
            
            // Émettre l'événement pour synchroniser la liste
            this.emitFilterChangeEvent();

        } catch (error) {
            console.error('❌ Erreur changement filtre caisse:', error);
            this.isAutoSelecting = false;
        }
    }

    async onEmployeeFilterChange(event) {
        try {
            const selectedValue = event.target.value;

            if (selectedValue) {
                this.state.selectedEmployee = parseInt(selectedValue);
                
                // Auto-sélectionner la caisse de l'employé (seulement si pas déjà en auto-sélection)
                if (!this.isAutoSelecting) {
                    this.isAutoSelecting = true;
                    
                    const selectedEmployee = this.state.allEmployees.find(e => e.id === parseInt(selectedValue));
                    if (selectedEmployee) {
                        try {
                            // Récupérer l'employé complet avec son user_id
                            const employeeFull = await this.orm.call("hr.employee", 'read', 
                                [parseInt(selectedValue)], 
                                { fields: ['user_id'] }
                            );
                            
                            if (employeeFull && employeeFull.length > 0 && employeeFull[0].user_id) {
                                const userId = employeeFull[0].user_id[0];
                                
                                // Trouver la caisse dont le responsable est cet utilisateur
                                const caisseWithUser = this.state.allCaisses.find(c => 
                                    c.user_id && c.user_id[0] === userId
                                );
                                
                                if (caisseWithUser) {
                                    this.state.selectedCaisses = [caisseWithUser.id];
                                    console.log('✅ EMPLOYÉ→CAISSE: Caisse auto-sélectionnée:', caisseWithUser.name, '(ID:', caisseWithUser.id, ')');
                                    
                                    // Recharger les mois pour cette caisse
                                    await this.loadMonths();
                                } else {
                                    // L'employé n'est responsable d'aucune caisse
                                    this.state.selectedCaisses = [];
                                    console.log('⚠️ Aucune caisse trouvée pour l\'employé:', selectedEmployee.name);
                                }
                            } else {
                                // L'employé n'a pas de user_id
                                this.state.selectedCaisses = [];
                                console.log('⚠️ L\'employé n\'a pas de user_id associé');
                            }
                        } catch (employeeError) {
                            console.warn('⚠️ Erreur récupération données employé:', employeeError);
                            this.state.selectedCaisses = [];
                        }
                    } else {
                        this.state.selectedCaisses = [];
                    }
                    
                    // Libérer le flag après un délai
                    setTimeout(() => {
                        this.isAutoSelecting = false;
                    }, 500);
                }
            } else {
                this.state.selectedEmployee = null;
                this.state.selectedCaisses = [];
            }

            // Recharger les données du dashboard
            await this.loadDashboardData();
            
            // Émettre l'événement pour synchroniser la liste
            this.emitFilterChangeEvent();

        } catch (error) {
            console.error('❌ Erreur changement filtre employé:', error);
            this.isAutoSelecting = false;
        }
    }

    async onDateFilterChange(event) {
        try {
            const selectedValue = event.target.value;

            this.state.selectedDate = selectedValue || null;

            if (selectedValue) {
                this.state.selectedMonth = null;
                this.state.selectedMonthDetails = null;
            }

            // Recharger les données du dashboard
            await this.loadDashboardData();
            
            // Émettre l'événement pour synchroniser la liste
            this.emitFilterChangeEvent();

        } catch (error) {
            console.error('❌ Erreur changement filtre date:', error);
        }
    }

    async onMonthFilterChange(event) {
        try {
            const selectedValue = event.target.value;

            if (selectedValue) {
                this.state.selectedMonth = parseInt(selectedValue);
                const monthDetails = this.state.allMonths.find(m => m.id === parseInt(selectedValue));
                this.state.selectedMonthDetails = monthDetails || null;

                this.state.selectedDate = null;
                
                // Auto-sélectionner la caisse et l'employé du mois (seulement si pas déjà en auto-sélection)
                if (!this.isAutoSelecting && monthDetails) {
                    this.isAutoSelecting = true;
                    
                    // Récupérer la caisse du mois
                    if (monthDetails.caisse_id) {
                        const caisseId = Array.isArray(monthDetails.caisse_id) ? monthDetails.caisse_id[0] : monthDetails.caisse_id;
                        this.state.selectedCaisses = [caisseId];
                        console.log('✅ MOIS→CAISSE: Caisse auto-sélectionnée:', caisseId);
                        
                        // Auto-sélectionner l'employé responsable de cette caisse
                        const selectedCaisse = this.state.allCaisses.find(c => c.id === caisseId);
                        if (selectedCaisse && selectedCaisse.user_id) {
                            const userId = selectedCaisse.user_id[0];
                            
                            try {
                                const employees = await this.orm.call("hr.employee", 'search_read', 
                                    [[['user_id', '=', userId]]], 
                                    { fields: ['id'], limit: 1 }
                                );
                                
                                if (employees && employees.length > 0) {
                                    this.state.selectedEmployee = employees[0].id;
                                    console.log('✅ MOIS→EMPLOYÉ: Employé auto-sélectionné:', employees[0].id);
                                } else {
                                    this.state.selectedEmployee = null;
                                }
                            } catch (employeeError) {
                                console.warn('⚠️ Erreur récupération employé:', employeeError);
                                this.state.selectedEmployee = null;
                            }
                        } else {
                            this.state.selectedEmployee = null;
                        }
                    } else {
                        // Pas de caisse associée au mois
                        this.state.selectedCaisses = [];
                        this.state.selectedEmployee = null;
                        console.log('⚠️ Mois sans caisse associée');
                    }
                    
                    // Libérer le flag après un délai
                    setTimeout(() => {
                        this.isAutoSelecting = false;
                    }, 500);
                }
            } else {
                this.state.selectedMonth = null;
                this.state.selectedMonthDetails = null;
            }

            // Recharger les données du dashboard
            await this.loadDashboardData();
            
            // Émettre l'événement pour synchroniser la liste
            this.emitFilterChangeEvent();

        } catch (error) {
            console.error('❌ Erreur changement filtre mois:', error);
            this.isAutoSelecting = false;
        }
    }

    async clearCaisseFilter() {
        try {

            this.state.selectedCaisses = [];
            this.state.selectedMonth = null;
            this.state.selectedDate = null;
            this.state.selectedMonthDetails = null;
            await this.loadDashboardData();
        } catch (error) {
        }
    }

    async clearEmployeeFilter() {
        try {
            this.state.selectedEmployee = null;
            await this.loadDashboardData();
        } catch (error) {
        }
    }

    async clearDateFilter() {
        try {

            this.state.selectedDate = null;
            await this.loadDashboardData();

        } catch (error) {
        }
    }

    async clearMonthFilter() {
        try {

            this.state.selectedMonth = null;
            this.state.selectedMonthDetails = null;
            await this.loadDashboardData();
        } catch (error) {
        }
    }

    getMonthFilterText() {
        try {
            if (!this.state.selectedMonth) {
                return this.state.selectedCaisses.length > 0 ? 'Tous les mois de la caisse' : 'Tous les mois';
            }
            const month = this.state.allMonths.find(m => m.id === this.state.selectedMonth);
            return month ? (month.display_name || month.name) : 'Mois sélectionné';
        } catch (error) {
            return 'Mois';
        }
    }

    getCaisseFilterText() {
        try {
            if (this.state.selectedCaisses.length === 0) {
                return 'Toutes les caisses';
            }
            if (this.state.selectedCaisses.length === 1) {
                const caisse = this.state.allCaisses.find(c => c.id === this.state.selectedCaisses[0]);
                if (caisse) {
                    const responsable = caisse.user_id && caisse.user_id[1] ? caisse.user_id[1] : 'Aucun responsable';
                    return `${caisse.name} - ${responsable}`;
                }
                return 'Caisse sélectionnée';
            }
            return `${this.state.selectedCaisses.length} caisses sélectionnées`;
        } catch (error) {
            return 'Caisses';
        }
    }

    getEmployeeFilterText() {
        try {
            if (!this.state.selectedEmployee) {
                return 'Tous les employés';
            }
            const employee = this.state.allEmployees.find(e => e.id === this.state.selectedEmployee);
            return employee ? employee.name : 'Employé sélectionné';
        } catch (error) {
            return 'Employés';
        }
    }

    renderMonetaryField(value, currency_id) {
        const safeValue = (typeof value === 'number') ? value : 0;
        return formatMonetaryWithSpaces(safeValue, currency_id || 1);
    }

    getExternalFiltersCount() {
        if (!this.externalFilters) return 0;
        return Object.keys(this.externalFilters).length;
    }

    hasActiveFilters() {
        // Vérifier s'il y a des filtres externes RÉELLEMENT actifs (pas juste des clés vides)
        let hasExternalFilters = false;
        if (this.externalFilters) {
            // Vérifier chaque filtre externe pour voir s'il a une valeur réelle
            const activeExternalFilters = Object.entries(this.externalFilters).filter(([key, value]) => {
                // Ignorer les valeurs null, undefined, ou fausses
                if (value === null || value === undefined || value === false) return false;

                // Pour les tableaux, vérifier qu'ils ne sont pas vides
                if (Array.isArray(value)) return value.length > 0;

                // Pour les objets, vérifier qu'ils ont des propriétés
                if (typeof value === 'object') return Object.keys(value).length > 0;

                // Pour les chaînes, vérifier qu'elles ne sont pas vides
                if (typeof value === 'string') return value.trim().length > 0;

                // Pour les autres types (nombres, booléens true), considérer comme actif
                return true;
            });

            hasExternalFilters = activeExternalFilters.length > 0;
        }

        const hasInternalFilters = this.state.selectedMonth || this.state.selectedDate || this.state.selectedCaisses.length > 0 || this.state.selectedEmployee;

        const isActive = hasExternalFilters || hasInternalFilters;

        return isActive;
    }

    getExternalFiltersText() {
        const result = {
            project: null,
            user: null,
            type: null,
            date: null,
            validation: null,
            attachments: null,
            amount: null,
            search: null
        };

        if (!this.externalFilters) return result;

        if (this.externalFilters.projectIds && this.externalFilters.projectIds.length > 0) {
            result.project = this.externalFilters.projectIds.length === 1 ?
                'Projet sélectionné' :
                `${this.externalFilters.projectIds.length} projets`;
        }

        if (this.externalFilters.userIds && this.externalFilters.userIds.length > 0) {
            result.user = this.externalFilters.userIds.length === 1 ?
                'Utilisateur sélectionné' :
                `${this.externalFilters.userIds.length} utilisateurs`;
        }

        if (this.externalFilters.projectManagerIds && this.externalFilters.projectManagerIds.length > 0) {
            result.user = this.externalFilters.projectManagerIds.length === 1 ?
                'Utilisateur sélectionné' :
                `${this.externalFilters.projectManagerIds.length} caissier`;
        }

        if (this.externalFilters.expenseType) {
            result.type = this.externalFilters.expenseType === 'spent' ?
                'Dépenses' : this.externalFilters.expenseType === 'replenish' ?
                'Alimentations' : 'Type filtré';
        }

        // NOUVEAUX filtres
        if (this.externalFilters.validationStatus !== null && this.externalFilters.validationStatus !== undefined) {
            const statusMap = {
                'envoyee': 'En attente',
                'valid': 'Validés',
                'invalide': 'Invalidés',
                'brouillon': 'Brouillons'
            };
            result.validation = statusMap[this.externalFilters.validationStatus] || 'Statut filtré';
        }

        if (this.externalFilters.hasAttachments === true) {
            result.attachments = 'Avec pièces jointes';
        } else if (this.externalFilters.hasAttachments === false) {
            result.attachments = 'Sans pièces jointes';
        }

        if (this.externalFilters.amountCondition) {
            const { operator, value } = this.externalFilters.amountCondition;
            result.amount = `Montant ${operator} ${value}`;
        }

        if (this.externalFilters.generalSearch) {
            result.search = `Recherche: "${this.externalFilters.generalSearch}"`;
        }

        if (this.externalFilters.dateRange) {
            if (this.externalFilters.dateRange.start && this.externalFilters.dateRange.end) {
                result.date = 'Période';
            } else if (this.externalFilters.dateRange.start) {
                result.date = 'Depuis ' + this.externalFilters.dateRange.start;
            } else if (this.externalFilters.dateRange.end) {
                result.date = 'Jusqu\'au ' + this.externalFilters.dateRange.end;
            }
        }

        return result;
    }

    async refreshData() {
        try {

            await this.loadDashboardData();
        } catch (error) {
            // console.error('❌ Erreur actualisation:', error);
        }
    }

    emitFilterChangeEvent() {
        try {
            // Ne pas émettre d'événement si on est en train d'appliquer des filtres externes
            if (this.isApplyingExternalFilters) {
                return;
            }

            console.log('📡 DASHBOARD: Émission événement filtre changé');

            // Construire le domaine exact à appliquer
            const domain = [];

            if (this.state.selectedCaisses.length > 0) {
                domain.push(['expense_account_id', 'in', this.state.selectedCaisses]);
            }

            if (this.state.selectedMonth) {
                domain.push(['caisse_mois_id', '=', this.state.selectedMonth]);
            } else if (this.state.selectedDate) {
                domain.push(['date', '>=', this.state.selectedDate + ' 00:00:00']);
                domain.push(['date', '<=', this.state.selectedDate + ' 23:59:59']);
            }

            if (this.state.selectedEmployee) {
                domain.push(['employee_id', '=', this.state.selectedEmployee]);
            }

            // Émettre l'événement avec le domaine pour la vue tree
            const filterData = {
                caisseIds: this.state.selectedCaisses,
                monthId: this.state.selectedMonth,
                selectedDate: this.state.selectedDate,
                employeeId: this.state.selectedEmployee,
                domain: domain,
                expectedCount: this.state.expenseMovements.length,
                timestamp: Date.now(), // Pour éviter les doublons
                applyToSearchBar: true // Nouvelle option pour appliquer à la barre de recherche
            };

            console.log('📡 DASHBOARD: Données filtre:', filterData);

            // Événement via bus Odoo
            if (this.env.bus) {
                this.env.bus.trigger('dashboard-filter-changed', filterData);
            }

            // Événement via window
            if (typeof window !== 'undefined') {
                const event = new CustomEvent('dashboard-filter-changed', {
                    detail: filterData
                });
                window.dispatchEvent(event);
            }

            // Mettre à jour l'URL pour la persistance (sans rechargement)
            this.updateURLOnly();

        } catch (error) {
            console.error('❌ SYNCHRONISATION: Erreur émission événement:', error);
        }
    }

    updateURLOnly() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);

                // Supprimer les anciens paramètres
                url.searchParams.delete('caisse_filter');
                url.searchParams.delete('month_filter');
                url.searchParams.delete('employee_filter');
                url.searchParams.delete('dashboard_filtered');

                // Ajouter les nouveaux si nécessaire
                if (this.state.selectedCaisses.length > 0) {
                    url.searchParams.set('caisse_filter', this.state.selectedCaisses.join(','));
                }

                if (this.state.selectedMonth) {
                    url.searchParams.set('month_filter', this.state.selectedMonth.toString());
                }

                if (this.state.selectedEmployee) {
                    url.searchParams.set('employee_filter', this.state.selectedEmployee.toString());
                }

                if (this.state.selectedCaisses.length > 0 || this.state.selectedMonth || this.state.selectedEmployee) {
                    url.searchParams.set('dashboard_filtered', '1');
                }

                // Mettre à jour l'URL sans rechargement
                window.history.pushState({}, '', url.toString());
            }
        } catch (error) {
            // console.error('❌ Erreur mise à jour URL:', error);
        }
    }

    setupSearchFilterListener() {
        try {

            // Écouter les événements depuis la vue search via window
            if (typeof window !== 'undefined') {
                window.addEventListener('search-filter-changed', (event) => {
                    this.applySearchFilters(event.detail);
                });
            }

            // Écouter aussi via env.bus si disponible
            if (this.env.bus) {
                this.env.bus.addEventListener('search-filter-changed', (event) => {
                    this.applySearchFilters(event.detail);
                });
            }

        } catch (error) {
            // console.error('❌ DASHBOARD: Erreur configuration écoute filtres:', error);
        }
    }

    async applySearchFilters(searchFilters) {
        try {

            // Marquer que nous appliquons des filtres externes
            this.isApplyingExternalFilters = true;

            let hasChanges = false;

            // LOGIQUE AMÉLIORÉE DE DÉTECTION DE RÉINITIALISATION
            const isCompleteReset = (
                !searchFilters ||
                searchFilters.isCompleteReset === true ||
                (searchFilters.searchDomain && searchFilters.searchDomain.length === 0) ||
                Object.keys(searchFilters || {}).length === 0 ||
                (searchFilters && !searchFilters.caisseIds && !searchFilters.projectIds &&
                !searchFilters.userIds && !searchFilters.projectManagerIds && !searchFilters.expenseType &&
                 !searchFilters.validationStatus && !searchFilters.hasAttachments &&
                 !searchFilters.amountCondition && !searchFilters.generalSearch &&
                 !searchFilters.dateRange && !searchFilters.monthId && !searchFilters.employeeIds)
            );


            // ÉTAPE 1: Réinitialiser TOUS les filtres externes si réinitialisation détectée
            if (isCompleteReset) {

                // Réinitialiser tous les filtres externes
                const hadExternalFilters = this.externalFilters && Object.keys(this.externalFilters).length > 0;
                this.externalFilters = {};

                // Réinitialiser les filtres internes SEULEMENT pour les filtres venant de la recherche
                // Ne pas toucher aux filtres du dropdown dashboard
                if (hadExternalFilters) {
                    hasChanges = true;
                }
            } else {
                // ÉTAPE 2: Traiter les filtres normalement
                if (!this.externalFilters) this.externalFilters = {};


                // Appliquer les filtres de caisse
                if (searchFilters.caisseIds && Array.isArray(searchFilters.caisseIds) && searchFilters.caisseIds.length > 0) {
                    const newCaisseIds = searchFilters.caisseIds;
                    // Store in external filters instead of state to avoid dropdown sync issues
                    if (JSON.stringify((this.externalFilters.caisseIds || []).sort()) !== JSON.stringify(newCaisseIds.sort())) {
                        this.externalFilters.caisseIds = [...newCaisseIds];
                        hasChanges = true;
                    }
                } else if (searchFilters.generalSearch) {
                    // Try to resolve general search to caisse IDs
                    const resolvedIds = await this.resolveCaisseFromSearch(searchFilters.generalSearch);
                    if (resolvedIds && resolvedIds.length > 0) {
                        if (JSON.stringify((this.externalFilters.caisseIds || []).sort()) !== JSON.stringify(resolvedIds.sort())) {
                            this.externalFilters.caisseIds = resolvedIds;
                            hasChanges = true;
                        }
                    }
                } else {
                    // Pas de filtre caisse ou filtre vide - réinitialiser
                    if (this.externalFilters.caisseIds && this.externalFilters.caisseIds.length > 0) {
                        delete this.externalFilters.caisseIds;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de projet - NOUVEAU
                if (searchFilters.projectIds && searchFilters.projectIds.length > 0) {
                    this.externalFilters.projectIds = searchFilters.projectIds;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.projectIds) {
                        delete this.externalFilters.projectIds;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres d'utilisateur (user_id) - NOUVEAU
                if (searchFilters.userIds && searchFilters.userIds.length > 0) {
                    this.externalFilters.userIds = searchFilters.userIds;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.userIds) {
                        delete this.externalFilters.userIds;
                        hasChanges = true;
                    }
                }

                if (searchFilters.projectManagerIds && searchFilters.projectManagerIds.length > 0) {
                    this.externalFilters.projectManagerIds = searchFilters.projectManagerIds;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.projectManagerIds) {
                        delete this.externalFilters.projectManagerIds;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de type de dépense - NOUVEAU
                if (searchFilters.expenseType) {
                    this.externalFilters.expenseType = searchFilters.expenseType;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.expenseType) {
                        delete this.externalFilters.expenseType;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de validation - NOUVEAU
                if (searchFilters.validationStatus !== null && searchFilters.validationStatus !== undefined) {
                    this.externalFilters.validationStatus = searchFilters.validationStatus;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.validationStatus !== undefined) {
                        delete this.externalFilters.validationStatus;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de pièces jointes - NOUVEAU
                if (searchFilters.hasAttachments !== null && searchFilters.hasAttachments !== undefined) {
                    this.externalFilters.hasAttachments = searchFilters.hasAttachments;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.hasAttachments !== undefined) {
                        delete this.externalFilters.hasAttachments;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de montant - NOUVEAU
                if (searchFilters.amountCondition) {
                    this.externalFilters.amountCondition = searchFilters.amountCondition;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.amountCondition) {
                        delete this.externalFilters.amountCondition;
                        hasChanges = true;
                    }
                }

                // Appliquer la recherche générale - NOUVEAU
                if (searchFilters.generalSearch) {
                    this.externalFilters.generalSearch = searchFilters.generalSearch;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.generalSearch) {
                        delete this.externalFilters.generalSearch;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de date - REMIS
                if (searchFilters.dateRange) {
                    this.externalFilters.dateRange = searchFilters.dateRange;
                    hasChanges = true;
                } else {
                    if (this.externalFilters.dateRange) {
                        delete this.externalFilters.dateRange;
                        hasChanges = true;
                    }
                }

                // Appliquer les filtres de mois seulement si on a une caisse
                if (searchFilters.monthId && this.state.selectedCaisses.length > 0) {
                    if (this.state.selectedMonth !== searchFilters.monthId) {
                        this.state.selectedMonth = searchFilters.monthId;
                        const monthDetails = this.state.allMonths.find(m => m.id === searchFilters.monthId);
                        this.state.selectedMonthDetails = monthDetails || null;
                        hasChanges = true;
                    }
                } else if (this.state.selectedMonth && !searchFilters.monthId) {
                    // Réinitialiser si pas de filtre mois
                    this.state.selectedMonth = null;
                    this.state.selectedMonthDetails = null;
                    hasChanges = true;
                }

                // Appliquer les filtres d'employé
                if (searchFilters.employeeIds && searchFilters.employeeIds.length > 0) {
                    // Prendre le premier employé si plusieurs sont sélectionnés
                    const employeeId = searchFilters.employeeIds[0];
                    if (this.state.selectedEmployee !== employeeId) {
                        this.state.selectedEmployee = employeeId;
                        hasChanges = true;
                    }
                } else if (this.state.selectedEmployee) {
                    // Réinitialiser si pas de filtre employé
                    this.state.selectedEmployee = null;
                    hasChanges = true;
                }
            }


            await this.loadDashboardData();

        } catch (error) {
            // console.error('❌ DASHBOARD: Erreur application filtres search:', error);
        } finally {
            // Débloquer après un délai
            setTimeout(() => {
                this.isApplyingExternalFilters = false;
            }, 800);
        }
    }

    async resolveCaisseFromSearch(searchText) {
        try {

            // Try exact match first
            const exactMatches = this.state.allCaisses.filter(c => {
                const caisseName = c.name || '';
                const userName = (c.user_id && c.user_id[1]) || '';
                const fullName = `${caisseName} - ${userName}`;

                return fullName.toLowerCase() === searchText.toLowerCase() ||
                       caisseName.toLowerCase() === searchText.toLowerCase();
            });

            if (exactMatches.length > 0) {
                return exactMatches.map(c => c.id);
            }

            // Try partial match
            const partialMatches = this.state.allCaisses.filter(c => {
                const caisseName = (c.name || '').toLowerCase();
                const userName = (c.user_id && c.user_id[1]) ? c.user_id[1].toLowerCase() : '';
                const fullName = `${caisseName} - ${userName}`;
                const searchLower = searchText.toLowerCase();

                return fullName.includes(searchLower) ||
                       caisseName.includes(searchLower) ||
                       userName.includes(searchLower);
            });

            if (partialMatches.length > 0) {
                return partialMatches.map(c => c.id);
            }

            return null;
        } catch (error) {
            console.error('❌ RESOLVE: Erreur résolution caisse:', error);
            return null;
        }
    }

    updateURL() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);

                // Supprimer les anciens paramètres
                url.searchParams.delete('caisse_filter');
                url.searchParams.delete('month_filter');
                url.searchParams.delete('employee_filter');
                url.searchParams.delete('dashboard_filtered');

                // Ajouter les nouveaux si nécessaire
                if (this.state.selectedCaisses.length > 0) {
                    url.searchParams.set('caisse_filter', this.state.selectedCaisses.join(','));
                }

                if (this.state.selectedMonth) {
                    url.searchParams.set('month_filter', this.state.selectedMonth.toString());
                }

                if (this.state.selectedEmployee) {
                    url.searchParams.set('employee_filter', this.state.selectedEmployee.toString());
                }

                if (this.state.selectedCaisses.length > 0 || this.state.selectedMonth || this.state.selectedEmployee) {
                    url.searchParams.set('dashboard_filtered', '1');
                }

                // Recharger la page pour appliquer les filtres
                if (url.toString() !== window.location.href) {
                    window.location.href = url.toString();
                }
            }
        } catch (error) {
            // console.error('❌ Erreur mise à jour URL:', error);
        }
    }

    async clearAllFilters() {
        try {
            console.log('🧹 CLEAR: Effacement de tous les filtres');

            // Désactiver l'auto-sélection pendant le reset
            this.isAutoSelecting = true;

            // Réinitialiser tous les filtres
            this.state.selectedCaisses = [];
            this.state.selectedMonth = null;
            this.state.selectedMonthDetails = null;
            this.state.selectedEmployee = null;
            this.state.selectedDate = null;

            console.log('✅ CLEAR: Filtres réinitialisés');

            // Recharger les données avec les filtres vides
            await this.loadDashboardData();

            // Émettre l'événement pour réinitialiser la liste
            this.emitFilterChangeEvent();

            console.log('✅ CLEAR: Dashboard et liste réinitialisés');

            // Libérer le flag après un délai
            setTimeout(() => {
                this.isAutoSelecting = false;
            }, 500);

            // Notification utilisateur (optionnel)
            if (this.notification) {
                this.notification.add('Filtres effacés', {
                    type: 'success',
                    title: 'Filtres réinitialisés'
                });
            }

        } catch (error) {
            console.error('❌ Erreur effacement filtres:', error);
            this.isAutoSelecting = false;
        }
    }
}

registry.category("actions").add("expense_dashboard", ExpenseDashboard);
