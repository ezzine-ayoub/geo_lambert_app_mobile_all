/** @odoo-module */

/**
 * Service for managing external filters from search view
 */
export class ExternalFiltersService {
    constructor() {
        this.filters = {};
    }

    /**
     * Apply search filters
     * @param {Object} searchFilters - Filters from search view
     * @returns {boolean} Whether changes were detected
     */
    applyFilters(searchFilters) {
        let hasChanges = false;
        
        // Check for complete reset
        const isCompleteReset = (
            !searchFilters || 
            searchFilters.isCompleteReset === true ||
            (searchFilters.searchDomain && searchFilters.searchDomain.length === 0) ||
            (Object.keys(searchFilters || {}).filter(k => k !== 'timestamp' && k !== 'source' && k !== 'searchDomain').length === 0) ||
            (searchFilters && 
             !searchFilters.caisseIds && 
             !searchFilters.projectIds && 
             !searchFilters.userIds && 
             !searchFilters.expenseType && 
             !searchFilters.validationStatus && 
             !searchFilters.hasAttachments &&
             !searchFilters.amountCondition && 
             !searchFilters.generalSearch &&
             !searchFilters.dateRange && 
             !searchFilters.monthId && 
             !searchFilters.employeeIds)
        );
        
        if (isCompleteReset) {
            if (Object.keys(this.filters).length > 0) {
                this.filters = {};
                hasChanges = true;
            }
            return hasChanges;
        }
        
        // Apply each filter type
        hasChanges = this._applyArrayFilter('caisseIds', searchFilters.caisseIds) || hasChanges;
        hasChanges = this._applyArrayFilter('projectIds', searchFilters.projectIds) || hasChanges;
        hasChanges = this._applyArrayFilter('userIds', searchFilters.userIds) || hasChanges;
        hasChanges = this._applyArrayFilter('employeeIds', searchFilters.employeeIds) || hasChanges;
        hasChanges = this._applyValueFilter('expenseType', searchFilters.expenseType) || hasChanges;
        hasChanges = this._applyValueFilter('validationStatus', searchFilters.validationStatus) || hasChanges;
        hasChanges = this._applyValueFilter('hasAttachments', searchFilters.hasAttachments) || hasChanges;
        hasChanges = this._applyValueFilter('amountCondition', searchFilters.amountCondition) || hasChanges;
        hasChanges = this._applyValueFilter('generalSearch', searchFilters.generalSearch) || hasChanges;
        hasChanges = this._applyValueFilter('dateRange', searchFilters.dateRange) || hasChanges;
        
        return hasChanges;
    }

    /**
     * Apply array-based filter
     * @private
     */
    _applyArrayFilter(key, value) {
        if (value && Array.isArray(value) && value.length > 0) {
            const oldValue = JSON.stringify(this.filters[key] || []);
            this.filters[key] = [...value];
            return oldValue !== JSON.stringify(value);
        } else {
            if (this.filters[key]) {
                delete this.filters[key];
                return true;
            }
        }
        return false;
    }

    /**
     * Apply value-based filter
     * @private
     */
    _applyValueFilter(key, value) {
        if (value !== null && value !== undefined && value !== '') {
            const oldValue = this.filters[key];
            this.filters[key] = value;
            return oldValue !== value;
        } else {
            if (this.filters[key] !== undefined) {
                delete this.filters[key];
                return true;
            }
        }
        return false;
    }

    /**
     * Build domain from current filters
     * @returns {Array} Odoo domain
     */
    buildDomain() {
        const domain = [];
        
        // Caisse filters (expense_account_id)
        if (this.filters.caisseIds && this.filters.caisseIds.length > 0) {
            domain.push(['expense_account_id', 'in', this.filters.caisseIds]);
            console.log('✅ DOMAIN BUILD: Ajout filtre caisse:', this.filters.caisseIds);
        }
        
        // Project filters
        if (this.filters.projectIds && this.filters.projectIds.length > 0) {
            domain.push(['project_id', 'in', this.filters.projectIds]);
        }
        
        // User filters
        if (this.filters.userIds && this.filters.userIds.length > 0) {
            domain.push(['user_id', 'in', this.filters.userIds]);
        }
        
        // Employee filters
        if (this.filters.employeeIds && this.filters.employeeIds.length > 0) {
            domain.push(['employee_id', 'in', this.filters.employeeIds]);
        }
        
        // Expense type filter
        if (this.filters.expenseType) {
            domain.push(['expense_move_type', '=', this.filters.expenseType]);
        }
        
        // Validation status filter
        if (this.filters.validationStatus !== null && this.filters.validationStatus !== undefined) {
            domain.push(['validate_by_administrator', '=', this.filters.validationStatus]);
        }
        
        // Attachments filter
        if (this.filters.hasAttachments === true) {
            domain.push(['attachment_ids', '!=', false]);
        } else if (this.filters.hasAttachments === false) {
            domain.push(['attachment_ids', '=', false]);
        }
        
        // Amount filter
        if (this.filters.amountCondition) {
            const { operator, value } = this.filters.amountCondition;
            domain.push(['total_amount', operator, value]);
        }
        
        // Date range filter
        if (this.filters.dateRange) {
            if (this.filters.dateRange.start) {
                domain.push(['date', '>=', this.filters.dateRange.start]);
            }
            if (this.filters.dateRange.end) {
                domain.push(['date', '<=', this.filters.dateRange.end]);
            }
        }
        
        // General search
        if (this.filters.generalSearch && this.filters.generalSearch.trim().length > 0) {
            const searchText = this.filters.generalSearch.trim();
            const searchConditions = [
                ['name', 'ilike', searchText],
                ['description', 'ilike', searchText],
                ['designation', 'ilike', searchText],
                ['employee_id', 'ilike', searchText]
            ];
            
            // Enhanced search for caisse names
            if (searchText.includes(' - ')) {
                const parts = searchText.split(' - ');
                const mainName = parts[0].trim();
                const managerName = parts[1].trim();
                
                searchConditions.push(['expense_account_id', 'ilike', mainName]);
            } else {
                searchConditions.push(['expense_account_id', 'ilike', searchText]);
            }
            
            // Build OR domain
            if (searchConditions.length > 1) {
                for (let i = 0; i < searchConditions.length - 1; i++) {
                    domain.push('|');
                }
            }
            searchConditions.forEach(condition => {
                domain.push(condition);
            });
        }
        
        return domain;
    }

    /**
     * Get count of active filters
     * @returns {number}
     */
    getCount() {
        return Object.keys(this.filters).length;
    }

    /**
     * Check if any filters are active
     * @returns {boolean}
     */
    hasActiveFilters() {
        return Object.keys(this.filters).length > 0;
    }

    /**
     * Get filter display text
     * @returns {Object} Display text for each filter type
     */
    getDisplayText() {
        return {
            caisse: this._getArrayDisplayText('caisseIds', 'caisse', 'caisses'),
            project: this._getArrayDisplayText('projectIds', 'projet', 'projets'),
            user: this._getArrayDisplayText('userIds', 'utilisateur', 'utilisateurs'),
            employee: this._getArrayDisplayText('employeeIds', 'employé', 'employés'),
            type: this._getTypeDisplayText(),
            validation: this._getValidationDisplayText(),
            attachments: this._getAttachmentsDisplayText(),
            amount: this._getAmountDisplayText(),
            search: this.filters.generalSearch ? `Recherche: "${this.filters.generalSearch}"` : null,
            date: this._getDateDisplayText()
        };
    }

    /**
     * Get display text for array filters
     * @private
     */
    _getArrayDisplayText(key, singular, plural) {
        if (this.filters[key] && this.filters[key].length > 0) {
            return this.filters[key].length === 1 ? 
                `${singular.charAt(0).toUpperCase() + singular.slice(1)} sélectionné` : 
                `${this.filters[key].length} ${plural}`;
        }
        return null;
    }

    /**
     * Get display text for expense type
     * @private
     */
    _getTypeDisplayText() {
        if (this.filters.expenseType) {
            return this.filters.expenseType === 'spent' ? 
                'Dépenses' : this.filters.expenseType === 'replenish' ? 
                'Alimentations' : 'Type filtré';
        }
        return null;
    }

    /**
     * Get display text for validation status
     * @private
     */
    _getValidationDisplayText() {
        if (this.filters.validationStatus !== null && this.filters.validationStatus !== undefined) {
            const statusMap = {
                'envoyee': 'En attente',
                'valid': 'Validés',
                'invalide': 'Invalidés',
                'brouillon': 'Brouillons'
            };
            return statusMap[this.filters.validationStatus] || 'Statut filtré';
        }
        return null;
    }

    /**
     * Get display text for attachments
     * @private
     */
    _getAttachmentsDisplayText() {
        if (this.filters.hasAttachments === true) {
            return 'Avec pièces jointes';
        } else if (this.filters.hasAttachments === false) {
            return 'Sans pièces jointes';
        }
        return null;
    }

    /**
     * Get display text for amount
     * @private
     */
    _getAmountDisplayText() {
        if (this.filters.amountCondition) {
            const { operator, value } = this.filters.amountCondition;
            return `Montant ${operator} ${value}`;
        }
        return null;
    }

    /**
     * Get display text for date range
     * @private
     */
    _getDateDisplayText() {
        if (this.filters.dateRange) {
            if (this.filters.dateRange.start && this.filters.dateRange.end) {
                return 'Période';
            } else if (this.filters.dateRange.start) {
                return 'Depuis ' + this.filters.dateRange.start;
            } else if (this.filters.dateRange.end) {
                return 'Jusqu\'au ' + this.filters.dateRange.end;
            }
        }
        return null;
    }

    /**
     * Reset all filters
     */
    reset() {
        this.filters = {};
    }

    /**
     * Get all filters
     * @returns {Object}
     */
    getFilters() {
        return this.filters;
    }
}
