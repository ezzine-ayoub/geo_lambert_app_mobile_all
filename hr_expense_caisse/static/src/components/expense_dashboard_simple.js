/** @odoo-module */
import { useService } from '@web/core/utils/hooks';
import { registry } from "@web/core/registry";
import { session } from '@web/session';
import { Component, onWillStart, useState } from "@odoo/owl";

function formatMonetaryWithSpaces(value, currency_id) {
    try {
        if (!value && value !== 0) value = 0;
        
        const formattedValue = new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
        
        const currency = session.get_currency(currency_id);
        if (currency) {
            if (currency.position === "after") {
                return formattedValue + " " + currency.symbol;
            } else {
                return currency.symbol + " " + formattedValue;
            }
        }
        return formattedValue + " DH";
    } catch (error) {
        // console.warn('Erreur formatage monétaire:', error);
        return (value || 0).toString() + " DH";
    }
}

export class ExpenseDashboardSimple extends Component {
    static template = 'hr_expense_caisse.ExpenseDashboardSimple';

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
            allMonths: [],
            selectedMonthDetails: null,
            totalBalance: 0,
            totalExpenses: 0,
            totalReplenishments: 0,
            expenseMovements: [],
            filteredCount: undefined
        });
        
        onWillStart(async () => {
            await this.loadDashboardData();
        });
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
                fields: ['id', 'name', 'type', 'balance']
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
                fields: ['id', 'name', 'caisse_id', 'sold', 'solde_initial', 'solde_final'],
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
            
            if (this.state.selectedCaisses.length > 0) {
                domain.push(['expense_account_id', 'in', this.state.selectedCaisses]);
            }
            
            if (this.state.selectedMonth) {
                domain.push(['caisse_mois_id', '=', this.state.selectedMonth]);
            }
            
            // console.log('🔍 Domaine pour mouvements:', domain);
            
            const movements = await this.orm.call("hr.expense.account.move", 'search_read', [domain], {
                fields: ['id', 'name', 'total_amount', 'expense_move_type', 'expense_account_id', 'caisse_mois_id'],
                limit: 1000
            });
            
            this.state.expenseMovements = Array.isArray(movements) ? movements : [];
            // console.log('✅ Mouvements chargés:', this.state.expenseMovements.length);
            
        } catch (error) {
            // console.error('❌ Erreur chargement mouvements:', error);
            this.state.expenseMovements = [];
        }
    }

    calculateStats() {
        try {
            let totalBalance = 0;
            let totalExpenses = 0;
            let totalReplenishments = 0;
            
            // Calculer depuis les caisses
            const caisses = this.state.selectedCaisses.length > 0 
                ? this.state.allCaisses.filter(c => this.state.selectedCaisses.includes(c.id))
                : this.state.allCaisses;
                
            caisses.forEach(caisse => {
                if (caisse && typeof caisse.balance === 'number') {
                    totalBalance += caisse.balance;
                }
            });
            
            // Calculer depuis les mouvements
            this.state.expenseMovements.forEach(movement => {
                if (movement && typeof movement.total_amount === 'number') {
                    if (movement.expense_move_type === 'spent') {
                        totalExpenses += movement.total_amount;
                    } else if (movement.expense_move_type === 'replenish') {
                        totalReplenishments += movement.total_amount;
                    }
                }
            });
            
            this.state.totalBalance = totalBalance;
            this.state.totalExpenses = totalExpenses;
            this.state.totalReplenishments = totalReplenishments;
            
            // console.log('📊 Stats calculées:', {
            //     balance: totalBalance,
            //     expenses: totalExpenses,
            //     replenishments: totalReplenishments
            // });
            
        } catch (error) {
            // console.error('❌ Erreur calcul stats:', error);
            // Valeurs par défaut en cas d'erreur
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
            
            this.state.selectedMonth = null;
            this.state.selectedMonthDetails = null;
            
            await this.loadDashboardData();
            
        } catch (error) {
            // console.error('❌ Erreur changement filtre caisse:', error);
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
            } else {
                this.state.selectedMonth = null;
                this.state.selectedMonthDetails = null;
            }
            
            await this.loadDashboardData();
            
        } catch (error) {
            // console.error('❌ Erreur changement filtre mois:', error);
        }
    }

    renderMonetaryField(value, currency_id) {
        const safeValue = (typeof value === 'number') ? value : 0;
        return formatMonetaryWithSpaces(safeValue, currency_id || 1);
    }

    async refreshData() {
        try {
            // console.log('🔄 Actualisation...');
            await this.loadDashboardData();
        } catch (error) {
            // console.error('❌ Erreur actualisation:', error);
        }
    }
}

registry.category("actions").add("expense_dashboard_simple", ExpenseDashboardSimple);
