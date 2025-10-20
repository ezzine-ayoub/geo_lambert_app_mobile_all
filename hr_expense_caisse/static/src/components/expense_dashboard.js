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
            allMonths: [],
            selectedMonthDetails: null,
            totalBalance: 0,
            totalExpenses: 0,
            totalReplenishments: 0,
            expenseMovements: [],
            filteredCount: undefined
        });
        
        onWillStart(async () => {
            // Charger les filtres depuis l'URL avant de charger les données
            await this.loadFiltersFromURL();
            await this.loadDashboardData();
            
            // Configurer l'écoute des changements de filtres de recherche
            this.setupSearchFilterListener();
            
            // Référence globale pour debug
            if (typeof window !== 'undefined') {
                window.expenseDashboard = this;
                // console.log('🌍 DEBUG: Dashboard disponible via window.expenseDashboard');
            }
        });
    }

    async loadFiltersFromURL() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);
                const caisseFilter = url.searchParams.get('caisse_filter');
                const monthFilter = url.searchParams.get('month_filter');
                const isDashboardFiltered = url.searchParams.get('dashboard_filtered');
                
                if (isDashboardFiltered) {
                    if (caisseFilter) {
                        const caisseIds = caisseFilter.split(',').map(id => parseInt(id));
                        this.state.selectedCaisses = caisseIds;
                        // console.log('🔗 Filtres caisse restaurés depuis URL:', caisseIds);
                    }
                    
                    if (monthFilter) {
                        this.state.selectedMonth = parseInt(monthFilter);
                        // console.log('🔗 Filtre mois restauré depuis URL:', this.state.selectedMonth);
                    }
                }
            }
        } catch (error) {
            // console.error('❌ Erreur chargement filtres depuis URL:', error);
        }
    }

    async loadDashboardData() {
        try {
            // console.log('🔄 Chargement des données...');
            // CORRECTION: Ne pas changer l'état de chargement pour éviter le flash
            
            // 1. Charger les caisses avec gestion d'erreur
            await this.loadCaisses();
            
            // 2. Charger les mois avec gestion d'erreur
            await this.loadMonths();
            
            // 3. Charger les mouvements avec gestion d'erreur
            await this.loadExpenseMovements();
            
            // 4. Calculer les statistiques
            this.calculateStats();
            
            // console.log('✅ Données chargées avec succès');
            // CORRECTION: Les données restent visibles pendant le rechargement
            
            // 5. Émettre l'événement de filtre après le chargement
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
            // console.log('✅ Caisses chargées:', this.state.allCaisses.length);
            
        } catch (error) {
            // console.error('❌ Erreur chargement caisses:', error);
            this.state.allCaisses = [];
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
            // console.log('✅ Mois chargés:', this.state.allMonths.length);
            
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
            
            // فلاتر خارجية من البحث - محدثة لدعم جميع الفلاتر
            if (this.externalFilters) {
                // فلاتر المشاريع
                if (this.externalFilters.projectIds && this.externalFilters.projectIds.length > 0) {
                    domain.push(['project_id', 'in', this.externalFilters.projectIds]);
                }
                
                // فلاتر المستخدمين
                if (this.externalFilters.userIds && this.externalFilters.userIds.length > 0) {
                    domain.push(['user_id', 'in', this.externalFilters.userIds]);
                }
                
                // فلاتر نوع النفقة
                if (this.externalFilters.expenseType) {
                    domain.push(['expense_move_type', '=', this.externalFilters.expenseType]);
                }
                
                // فلاتر حالة التحقق - جديد
                if (this.externalFilters.validationStatus !== null && this.externalFilters.validationStatus !== undefined) {
                    domain.push(['validate_by_administrator', '=', this.externalFilters.validationStatus]);
                }
                
                // فلاتر المرفقات - جديد
                if (this.externalFilters.hasAttachments === true) {
                    domain.push(['attachment_ids', '!=', false]);
                } else if (this.externalFilters.hasAttachments === false) {
                    domain.push(['attachment_ids', '=', false]);
                }
                
                // فلاتر المبلغ - جديد
                if (this.externalFilters.amountCondition) {
                    const { operator, value } = this.externalFilters.amountCondition;
                    domain.push(['total_amount', operator, value]);
                }
                
                // فلاتر التاريخ
                if (this.externalFilters.dateRange) {
                    if (this.externalFilters.dateRange.start) {
                        domain.push(['date', '>=', this.externalFilters.dateRange.start]);
                    }
                    if (this.externalFilters.dateRange.end) {
                        domain.push(['date', '<=', this.externalFilters.dateRange.end]);
                    }
                }
                
                // البحث العام - محسن للبحث في عدة حقول (محسن)
                if (this.externalFilters.generalSearch && this.externalFilters.generalSearch.trim().length > 0) {
                    const searchText = this.externalFilters.generalSearch.trim();
                    // console.log('🔍 DASHBOARD: Application recherche générale:', searchText);
                    
                    // بناء مجموعة شروط OR للبحث في عدة حقول
                    const searchConditions = [
                        ['name', 'ilike', searchText],
                        ['description', 'ilike', searchText],
                        ['designation', 'ilike', searchText]
                    ];
                    
                    // اضافة بحت في العلاقات (many2one fields)
                    // البحث في أسماء المشاريع
                    if (searchText.toLowerCase().includes('project') || /^project\s*\d+$/i.test(searchText)) {
                        // إذا كان البحث يشبه "Project 2" أو "مشروع"
                        searchConditions.push(['project_id', 'ilike', searchText]);
                    }
                    
                // البحث في أسماء الكايس - محسن للتعامل مع "Nom - Manager"
                if (searchText.toLowerCase().includes('caisse') || 
                    searchText.toLowerCase().includes('cash') || 
                    searchText.toLowerCase().includes('demo') ||
                    searchText.toLowerCase().includes('project') ||
                    searchText.toLowerCase().includes('administrator') ||
                    searchText.includes(' - ')) {
                    // بحث ذكي: إذا كان النص يحتوي على " - " فهو على الأرجح "اسم - مدير"
                    if (searchText.includes(' - ')) {
                        const parts = searchText.split(' - ');
                        const mainName = parts[0].trim();
                        const managerName = parts[1].trim();
                        
                        // بحث في الأجزاء المنفصلة
                        searchConditions.push(['expense_account_id', 'ilike', mainName]);
                        searchConditions.push(['project_manager_id', 'ilike', managerName]);
                        searchConditions.push(['project_id', 'ilike', mainName]);
                        
                        console.log('🔍 DASHBOARD: Recherche divisée:', { mainName, managerName });
                    } else {
                        // بحث عادي
                        searchConditions.push(['expense_account_id', 'ilike', searchText]);
                        searchConditions.push(['project_manager_id', 'ilike', searchText]);
                        searchConditions.push(['project_id', 'ilike', searchText]);
                    }
                }
                    
                    // تطبيق شروط OR
                    if (searchConditions.length === 1) {
                        domain.push(searchConditions[0]);
                    } else if (searchConditions.length > 1) {
                        // بناء دومين OR معقد
                        for (let i = 0; i < searchConditions.length - 1; i++) {
                            domain.push('|');
                        }
                        searchConditions.forEach(condition => {
                            domain.push(condition);
                        });
                    }
                    
                    // console.log('🔍 DASHBOARD: Domaine de recherche appliqué:', domain.slice(-searchConditions.length * 2 + 1));
                }
            }
            
            // console.log('🔍 MOVEMENTS: Domaine pour mouvements (avec filtres externes):', {
            //     domain: domain,
            //     hasActiveFilters: this.hasActiveFilters(),
            //     externalFilters: this.externalFilters
            // });
            
            const movements = await this.orm.call("hr.expense.account.move", 'search_read', [domain], {
                fields: ['id', 'name', 'total_amount', 'expense_move_type', 'expense_account_id', 'caisse_mois_id', 'project_id', 'user_id', 'date'],
                limit: 1000
            });
            
            this.state.expenseMovements = Array.isArray(movements) ? movements : [];
            // console.log('✅ MOVEMENTS: Mouvements chargés avec filtres externes:', {
            //     count: this.state.expenseMovements.length,
            //     hasFilters: this.hasActiveFilters()
            // });
            
            // تخزين عدد الحركات للمراجعة
            this.state.filteredCount = this.state.expenseMovements.length;
            
        } catch (error) {
            // console.error('❌ MOVEMENTS: Erreur chargement mouvements:', error);
            this.state.expenseMovements = [];
            this.state.filteredCount = 0;
        }
    }

    calculateStats() {
        try {
            let totalBalance = 0;
            let totalExpenses = 0;
            let totalReplenishments = 0;
            
            // حساب الإحصائيات بناءً على الحركات المُفلترة بدلاً من الكايس مباشرة
            // console.log('📊 STATS: حساب الإحصائيات من الحركات المُفلترة:', this.state.expenseMovements.length);
            
            // حساب من الحركات المُفلترة
            this.state.expenseMovements.forEach(movement => {
                if (movement && typeof movement.total_amount === 'number') {
                    if (movement.expense_move_type === 'spent') {
                        totalExpenses += movement.total_amount;
                    } else if (movement.expense_move_type === 'replenish') {
                        totalReplenishments += movement.total_amount;
                    }
                }
            });
            
            // حساب الرصيد = الإمدادات - المصروفات (من البيانات المُفلترة)
            totalBalance = totalReplenishments - totalExpenses;
            
            // إذا لم تكن هناك فلاتر خارجية، احسب من الكايس مباشرة للرصيد فقط
            if (!this.hasActiveFilters()) {
                // console.log('📊 STATS: لا توجد فلاتر نشطة - حساب الرصيد من الكايس');
                totalBalance = 0;
                
                // حساب من الكايس المحددة أو جميع الكايس
                const caisses = this.state.selectedCaisses.length > 0 
                    ? this.state.allCaisses.filter(c => this.state.selectedCaisses.includes(c.id))
                    : this.state.allCaisses;
                    
                caisses.forEach(caisse => {
                    if (caisse && typeof caisse.balance === 'number') {
                        totalBalance += caisse.balance;
                    }
                });
            } else {
                // console.log('📊 STATS: فلاتر نشطة - حساب الرصيد من الحركات المُفلترة');
            }
            
            this.state.totalBalance = totalBalance;
            this.state.totalExpenses = totalExpenses;
            this.state.totalReplenishments = totalReplenishments;
            
            // console.log('📊 STATS: إحصائيات محسوبة (مع الفلاتر):', {
            //     balance: totalBalance,
            //     expenses: totalExpenses,
            //     replenishments: totalReplenishments,
            //     hasFilters: this.hasActiveFilters()
            // });
            
        } catch (error) {
            // console.error('❌ STATS: خطأ في حساب الإحصائيات:', error);
            // قيم افتراضية في حالة الخطأ
            this.state.totalBalance = 0;
            this.state.totalExpenses = 0;
            this.state.totalReplenishments = 0;
        }
    }

    async onCaisseFilterChange(event) {
        try {
            const selectedValue = event.target.value;
            // console.log('🔄 Changement filtre caisse:', selectedValue);
            
            if (selectedValue) {
                this.state.selectedCaisses = [parseInt(selectedValue)];
            } else {
                this.state.selectedCaisses = [];
            }
            
            // Réinitialiser les filtres de mois et date quand on change de caisse
            this.state.selectedMonth = null;
            this.state.selectedDate = null;
            this.state.selectedMonthDetails = null;
            
            await this.loadDashboardData();
            this.emitFilterChangeEvent();
            
        } catch (error) {
            // console.error('❌ Erreur changement filtre caisse:', error);
        }
    }

    async onDateFilterChange(event) {
        try {
            const selectedValue = event.target.value;
            // console.log('🔄 Changement filtre date:', selectedValue);
            
            this.state.selectedDate = selectedValue || null;
            
            // Si on sélectionne une date, désactiver le filtre de mois
            if (selectedValue) {
                this.state.selectedMonth = null;
                this.state.selectedMonthDetails = null;
            }
            
            await this.loadDashboardData();
            this.emitFilterChangeEvent();
            
        } catch (error) {
            // console.error('❌ Erreur changement filtre date:', error);
        }
    }

    async onMonthFilterChange(event) {
        try {
            const selectedValue = event.target.value;
            // console.log('🔄 Changement filtre mois:', selectedValue);
            
            if (selectedValue) {
                this.state.selectedMonth = parseInt(selectedValue);
                const monthDetails = this.state.allMonths.find(m => m.id === this.state.selectedMonth);
                this.state.selectedMonthDetails = monthDetails || null;
                
                // Si on sélectionne un mois, désactiver le filtre de date
                this.state.selectedDate = null;
            } else {
                this.state.selectedMonth = null;
                this.state.selectedMonthDetails = null;
            }
            
            await this.loadDashboardData();
            this.emitFilterChangeEvent();
            
        } catch (error) {
            // console.error('❌ Erreur changement filtre mois:', error);
        }
    }

    async clearCaisseFilter() {
        try {
            // console.log('🗑️ Effacement filtre caisse');
            this.state.selectedCaisses = [];
            this.state.selectedMonth = null;
            this.state.selectedDate = null;
            this.state.selectedMonthDetails = null;
            await this.loadDashboardData();
            // TEMPORAIREMENT DÉSACTIVÉ POUR ÉVITER LES BOUCLES D'ERREURS
            // this.emitFilterChangeEvent();
        } catch (error) {
            // console.error('❌ Erreur effacement filtre caisse:', error);
        }
    }

    async clearDateFilter() {
        try {
            // console.log('🗑️ Effacement filtre date');
            this.state.selectedDate = null;
            await this.loadDashboardData();
            // TEMPORAIREMENT DÉSACTIVÉ POUR ÉVITER LES BOUCLES D'ERREURS
            // this.emitFilterChangeEvent();
        } catch (error) {
            // console.error('❌ Erreur effacement filtre date:', error);
        }
    }

    async clearMonthFilter() {
        try {
            // console.log('🗑️ Effacement filtre mois');
            this.state.selectedMonth = null;
            this.state.selectedMonthDetails = null;
            await this.loadDashboardData();
            // TEMPORAIREMENT DÉSACTIVÉ POUR ÉVITER LES BOUCLES D'ERREURS
            // this.emitFilterChangeEvent();
        } catch (error) {
            // console.error('❌ Erreur effacement filtre mois:', error);
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

    renderMonetaryField(value, currency_id) {
        const safeValue = (typeof value === 'number') ? value : 0;
        return formatMonetaryWithSpaces(safeValue, currency_id || 1);
    }

    getExternalFiltersCount() {
        if (!this.externalFilters) return 0;
        return Object.keys(this.externalFilters).length;
    }
    
    hasActiveFilters() {
        // التحقق من وجود أي فلاتر نشطة (خارجية أو داخلية)
        const hasExternalFilters = this.externalFilters && Object.keys(this.externalFilters).length > 0;
        const hasInternalFilters = this.state.selectedMonth || this.state.selectedDate;
        
        return hasExternalFilters || hasInternalFilters;
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
            // console.log('🔄 Actualisation...');
            await this.loadDashboardData();
        } catch (error) {
            // console.error('❌ Erreur actualisation:', error);
        }
    }

    emitFilterChangeEvent() {
        try {
            // Ne pas émettre d'événement si on est en train d'appliquer des filtres externes
            if (this.isApplyingExternalFilters) {
                // console.log('⏭️ SYNCHRONISATION: Émission événement bloquée (filtres externes)');
                return;
            }
            
            // console.log('📡 SYNCHRONISATION: Émission événement filtre avec protection:', {
            //     caisseIds: this.state.selectedCaisses,
            //     monthId: this.state.selectedMonth,
            //     selectedDate: this.state.selectedDate,
            //     mouvements: this.state.expenseMovements.length
            // });
            
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
            
            // console.log('🔍 SYNCHRONISATION: Domaine à appliquer:', domain);
            
            // Émettre l'événement avec le domaine pour la vue tree
            const filterData = {
                caisseIds: this.state.selectedCaisses,
                monthId: this.state.selectedMonth,
                selectedDate: this.state.selectedDate,
                domain: domain,
                expectedCount: this.state.expenseMovements.length,
                timestamp: Date.now() // Pour éviter les doublons
            };
            
            // Événement via bus Odoo
            if (this.env.bus) {
                this.env.bus.trigger('dashboard-filter-changed', filterData);
                // console.log('🚌 SYNCHRONISATION: Événement émis via env.bus');
            }
            
            // Événement via window
            if (typeof window !== 'undefined') {
                const event = new CustomEvent('dashboard-filter-changed', {
                    detail: filterData
                });
                window.dispatchEvent(event);
                // console.log('🌍 SYNCHRONISATION: Événement émis via window');
            }
            
            // Mettre à jour l'URL pour la persistance (sans rechargement)
            this.updateURLOnly();
            
        } catch (error) {
            // console.error('❌ SYNCHRONISATION: Erreur émission événement:', error);
        }
    }
    
    updateURLOnly() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);
                
                // Supprimer les anciens paramètres
                url.searchParams.delete('caisse_filter');
                url.searchParams.delete('month_filter');
                url.searchParams.delete('dashboard_filtered');
                
                // Ajouter les nouveaux si nécessaire
                if (this.state.selectedCaisses.length > 0) {
                    url.searchParams.set('caisse_filter', this.state.selectedCaisses.join(','));
                }
                
                if (this.state.selectedMonth) {
                    url.searchParams.set('month_filter', this.state.selectedMonth.toString());
                }
                
                if (this.state.selectedCaisses.length > 0 || this.state.selectedMonth) {
                    url.searchParams.set('dashboard_filtered', '1');
                }
                
                // Mettre à jour l'URL sans rechargement
                window.history.pushState({}, '', url.toString());
                // console.log('🔗 SYNCHRONISATION: URL mise à jour sans rechargement:', url.toString());
            }
        } catch (error) {
            // console.error('❌ Erreur mise à jour URL:', error);
        }
    }
    
    setupSearchFilterListener() {
        try {
            // console.log('🔊 DASHBOARD: Configuration écoute des filtres search');
            
            // Écouter les événements depuis la vue search via window
            if (typeof window !== 'undefined') {
                window.addEventListener('search-filter-changed', (event) => {
                    // console.log('🎯 DASHBOARD: Réception filtre depuis search:', event.detail);
                    this.applySearchFilters(event.detail);
                });
            }
            
            // Écouter aussi via env.bus si disponible
            if (this.env.bus) {
                this.env.bus.addEventListener('search-filter-changed', (event) => {
                    // console.log('🎧 DASHBOARD: Réception filtre depuis search via bus:', event.detail);
                    this.applySearchFilters(event.detail);
                });
            }
            
        } catch (error) {
            // console.error('❌ DASHBOARD: Erreur configuration écoute filtres:', error);
        }
    }
    
    async applySearchFilters(searchFilters) {
        try {
            // console.log('🔍 DEBUG: applySearchFilters appelé avec:', {
            //     searchFilters: searchFilters,
            //     searchFiltersType: typeof searchFilters,
            //     searchFiltersKeys: searchFilters ? Object.keys(searchFilters) : 'null',
            //     searchDomain: searchFilters ? searchFilters.searchDomain : 'undefined',
            //     searchDomainLength: searchFilters && searchFilters.searchDomain ? searchFilters.searchDomain.length : 'N/A',
            //     isCompleteReset: searchFilters ? searchFilters.isCompleteReset : 'undefined'
            // });
            
            // AJOUT TEMPORAIRE DE DEBUG pour identifier le problème
            console.log('🔍 DEBUG DASHBOARD: applySearchFilters appelé avec:', {
                searchFilters: searchFilters,
                searchFiltersType: typeof searchFilters,
                searchFiltersKeys: searchFilters ? Object.keys(searchFilters) : 'null',
                searchDomain: searchFilters ? searchFilters.searchDomain : 'undefined',
                searchDomainLength: searchFilters && searchFilters.searchDomain ? searchFilters.searchDomain.length : 'N/A',
                isCompleteReset: searchFilters ? searchFilters.isCompleteReset : 'undefined',
                generalSearch: searchFilters ? searchFilters.generalSearch : 'undefined',
                projectIds: searchFilters ? searchFilters.projectIds : 'undefined',
                timestamp: new Date().toLocaleTimeString()
            });
            
            // TOUJOURS traiter les filtres, même s'ils sont null/undefined/vides
            // console.log('🔄 DASHBOARD: Application filtres depuis search (incluant réinitialisation):', {
            //     searchFilters,
            //     hasSearchFilters: !!searchFilters,
            //     currentCaisses: this.state.selectedCaisses,
            //     currentMonth: this.state.selectedMonth,
            //     hasExternalFilters: !!this.externalFilters
            // });
            
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
                 !searchFilters.userIds && !searchFilters.expenseType && 
                 !searchFilters.validationStatus && !searchFilters.hasAttachments &&
                 !searchFilters.amountCondition && !searchFilters.generalSearch &&
                 !searchFilters.dateRange && !searchFilters.monthId)
            );
            
            // console.log('🔍 DEBUG: Détection de réinitialisation:', {
            //     isCompleteReset,
            //     hasSearchFilters: !!searchFilters,
            //     isCompleteResetFlag: searchFilters ? searchFilters.isCompleteReset : 'undefined',
            //     searchDomainEmpty: searchFilters && searchFilters.searchDomain ? searchFilters.searchDomain.length === 0 : 'N/A'
            // });
            
            // ÉTAPE 1: Réinitialiser TOUS les filtres externes si réinitialisation détectée
            if (isCompleteReset) {
                // console.log('🧽 DASHBOARD: RÉINITIALISATION COMPLÈTE DÉTECTÉE - Nettoyage de tous les filtres');
                
                // Réinitialiser tous les filtres externes
                this.externalFilters = {};
                
                // Réinitialiser les filtres internes
                if (this.state.selectedCaisses.length > 0 || this.state.selectedMonth || this.state.selectedDate) {
                    this.state.selectedCaisses = [];
                    this.state.selectedMonth = null;
                    this.state.selectedDate = null;
                    this.state.selectedMonthDetails = null;
                    hasChanges = true;
                    // console.log('🧽 DASHBOARD: Tous les filtres réinitialisés');
                }
            } else {
                // ÉTAPE 2: Traiter les filtres normalement
                if (!this.externalFilters) this.externalFilters = {};
                
                // console.log('🔄 DEBUG: Application normale des filtres:', searchFilters);
                
                // Appliquer les filtres de caisse
                if (searchFilters.caisseIds && Array.isArray(searchFilters.caisseIds) && searchFilters.caisseIds.length > 0) {
                    const newCaisseIds = searchFilters.caisseIds;
                    if (JSON.stringify(this.state.selectedCaisses.sort()) !== JSON.stringify(newCaisseIds.sort())) {
                        this.state.selectedCaisses = [...newCaisseIds];
                        hasChanges = true;
                        // console.log('✅ DASHBOARD: Filtres caisse appliqués:', newCaisseIds);
                        
                        // Quand on change de caisse, réinitialiser le mois
                        if (this.state.selectedMonth) {
                            this.state.selectedMonth = null;
                            this.state.selectedMonthDetails = null;
                            // console.log('🧽 DASHBOARD: Mois réinitialisé (changement caisse)');
                        }
                    }
                } else {
                    // Pas de filtre caisse ou filtre vide - réinitialiser
                    if (this.state.selectedCaisses.length > 0) {
                        this.state.selectedCaisses = [];
                        this.state.selectedMonth = null;
                        this.state.selectedMonthDetails = null;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtres caisse réinitialisés (domaine vide)');
                    }
                }
            
                // Appliquer les filtres de projet - NOUVEAU
                if (searchFilters.projectIds && searchFilters.projectIds.length > 0) {
                    this.externalFilters.projectIds = searchFilters.projectIds;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtres projet appliqués:', searchFilters.projectIds);
                } else {
                    if (this.externalFilters.projectIds) {
                        delete this.externalFilters.projectIds;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtres projet réinitialisés');
                    }
                }
                
                // Appliquer les filtres d'utilisateur - NOUVEAU
                if (searchFilters.userIds && searchFilters.userIds.length > 0) {
                    this.externalFilters.userIds = searchFilters.userIds;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtres utilisateur appliqués:', searchFilters.userIds);
                } else {
                    if (this.externalFilters.userIds) {
                        delete this.externalFilters.userIds;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtres utilisateur réinitialisés');
                    }
                }
                
                // Appliquer les filtres de type de dépense - NOUVEAU
                if (searchFilters.expenseType) {
                    this.externalFilters.expenseType = searchFilters.expenseType;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtre type dépense appliqué:', searchFilters.expenseType);
                } else {
                    if (this.externalFilters.expenseType) {
                        delete this.externalFilters.expenseType;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtre type dépense réinitialisé');
                    }
                }
                
                // Appliquer les filtres de validation - NOUVEAU
                if (searchFilters.validationStatus !== null && searchFilters.validationStatus !== undefined) {
                    this.externalFilters.validationStatus = searchFilters.validationStatus;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtre validation appliqué:', searchFilters.validationStatus);
                } else {
                    if (this.externalFilters.validationStatus !== undefined) {
                        delete this.externalFilters.validationStatus;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtre validation réinitialisé');
                    }
                }
                
                // Appliquer les filtres de pièces jointes - NOUVEAU
                if (searchFilters.hasAttachments !== null && searchFilters.hasAttachments !== undefined) {
                    this.externalFilters.hasAttachments = searchFilters.hasAttachments;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtre pièces jointes appliqué:', searchFilters.hasAttachments);
                } else {
                    if (this.externalFilters.hasAttachments !== undefined) {
                        delete this.externalFilters.hasAttachments;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtre pièces jointes réinitialisé');
                    }
                }
                
                // Appliquer les filtres de montant - NOUVEAU
                if (searchFilters.amountCondition) {
                    this.externalFilters.amountCondition = searchFilters.amountCondition;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtre montant appliqué:', searchFilters.amountCondition);
                } else {
                    if (this.externalFilters.amountCondition) {
                        delete this.externalFilters.amountCondition;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtre montant réinitialisé');
                    }
                }
                
                // Appliquer la recherche générale - NOUVEAU
                if (searchFilters.generalSearch) {
                    this.externalFilters.generalSearch = searchFilters.generalSearch;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Recherche générale appliquée:', searchFilters.generalSearch);
                } else {
                    if (this.externalFilters.generalSearch) {
                        delete this.externalFilters.generalSearch;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Recherche générale réinitialisée');
                    }
                }
                
                // Appliquer les filtres de date - REMIS
                if (searchFilters.dateRange) {
                    this.externalFilters.dateRange = searchFilters.dateRange;
                    hasChanges = true;
                    // console.log('✅ DASHBOARD: Filtres date appliqués:', searchFilters.dateRange);
                } else {
                    if (this.externalFilters.dateRange) {
                        delete this.externalFilters.dateRange;
                        hasChanges = true;
                        // console.log('🧽 DASHBOARD: Filtres date réinitialisés');
                    }
                }
                
                // Appliquer les filtres de mois seulement si on a une caisse
                if (searchFilters.monthId && this.state.selectedCaisses.length > 0) {
                    if (this.state.selectedMonth !== searchFilters.monthId) {
                        this.state.selectedMonth = searchFilters.monthId;
                        const monthDetails = this.state.allMonths.find(m => m.id === searchFilters.monthId);
                        this.state.selectedMonthDetails = monthDetails || null;
                        hasChanges = true;
                        // console.log('✅ DASHBOARD: Filtre mois appliqué:', searchFilters.monthId);
                    }
                } else if (this.state.selectedMonth && !searchFilters.monthId) {
                    // Réinitialiser si pas de filtre mois
                    this.state.selectedMonth = null;
                    this.state.selectedMonthDetails = null;
                    hasChanges = true;
                    // console.log('🧽 DASHBOARD: Filtre mois réinitialisé');
                }
            }
            
            // TOUJOURS recharger les données (même si pas de changements apparents)
            // pour s'assurer que la réinitialisation soit prise en compte
            // console.log('🔄 DASHBOARD: Rechargement des données (forcé pour synchronisation):', {
            //     hasChanges,
            //     hasExternalFilters: this.externalFilters && Object.keys(this.externalFilters).length > 0,
            //     selectedCaisses: this.state.selectedCaisses.length
            // });
            
            await this.loadDashboardData();
            // console.log('✅ DASHBOARD: Données rechargées avec succès');
            
        } catch (error) {
            // console.error('❌ DASHBOARD: Erreur application filtres search:', error);
        } finally {
            // Débloquer après un délai
            setTimeout(() => {
                this.isApplyingExternalFilters = false;
                // console.log('🔓 DASHBOARD: Flag externe réinitialisé');
            }, 800);
        }
    }
    
    updateURL() {
        try {
            if (typeof window !== 'undefined' && window.location) {
                const url = new URL(window.location.href);
                
                // Supprimer les anciens paramètres
                url.searchParams.delete('caisse_filter');
                url.searchParams.delete('month_filter');
                url.searchParams.delete('dashboard_filtered');
                
                // Ajouter les nouveaux si nécessaire
                if (this.state.selectedCaisses.length > 0) {
                    url.searchParams.set('caisse_filter', this.state.selectedCaisses.join(','));
                }
                
                if (this.state.selectedMonth) {
                    url.searchParams.set('month_filter', this.state.selectedMonth.toString());
                }
                
                if (this.state.selectedCaisses.length > 0 || this.state.selectedMonth) {
                    url.searchParams.set('dashboard_filtered', '1');
                }
                
                // Recharger la page pour appliquer les filtres
                if (url.toString() !== window.location.href) {
                    // console.log('🔗 SYNCHRONISATION: Redirection vers:', url.toString());
                    window.location.href = url.toString();
                } else {
                    // console.log('🔗 SYNCHRONISATION: URL déjà à jour');
                }
            }
        } catch (error) {
            // console.error('❌ Erreur mise à jour URL:', error);
        }
    }
}

registry.category("actions").add("expense_dashboard", ExpenseDashboard);
