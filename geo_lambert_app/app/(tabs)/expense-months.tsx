import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import expenseAccountService, {
  type ExpenseAccount,
  type ExpenseMonth,
  type ExpenseTransaction,
  subscribeToExpenseAccountUpdates
} from '../../services/expenseAccountService';

export default function ExpenseMonthsScreen() {
  const [expenseAccount, setExpenseAccount] = useState<ExpenseAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set());
  const [selectedYear, setSelectedYear] = useState<string>('all');

  // Charger les données du compte de dépenses
  const loadExpenseAccount = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }

      const response = await expenseAccountService.getExpenseAccounts();

      if (response.success && response.result && response.result.length > 0) {
        setExpenseAccount(response.result[0]);
      } else {
        Alert.alert('Erreur', response.message || 'Impossible de charger les données');
      }
    } catch (error) {
      console.error('❌ Erreur chargement compte de dépenses:', error);
      Alert.alert('Erreur', 'Impossible de charger les données');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Charger au démarrage
  useEffect(() => {
    loadExpenseAccount();
  }, [loadExpenseAccount]);

  // S'abonner aux mises à jour en temps réel depuis WebSocket
  useEffect(() => {
    console.log('📡 Abonnement aux mises à jour de mois en temps réel...');

    const unsubscribe = subscribeToExpenseAccountUpdates((updatedAccount) => {
      console.log('🔄 Mise à jour mois reçue depuis WebSocket:', {
        account_id: updatedAccount.id,
        account_name: updatedAccount.display_name,
        months_count: updatedAccount.month_ids?.length || 0
      });

      // Mettre à jour l'état local sans appeler l'API
      setExpenseAccount(updatedAccount);
      console.log('✅ Vue expense-months mise à jour automatiquement');
    });

    // Cleanup au démontage
    return () => {
      console.log('🧹 Désabonnement des mises à jour de mois');
      unsubscribe();
    };
  }, []);

  // Pull to refresh - Force refresh depuis API
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      console.log('🔄 Force refresh compte de dépenses depuis API...');
      const response = await expenseAccountService.forceRefreshExpenseAccounts();

      if (response.success && response.result && response.result.length > 0) {
        setExpenseAccount(response.result[0]);
        console.log('✅ Compte de dépenses rafraîchi avec succès');
      } else {
        Alert.alert('Erreur', response.message || 'Impossible de rafraîchir les données');
      }
    } catch (error) {
      console.error('❌ Erreur force refresh:', error);
      Alert.alert('Erreur', 'Impossible de rafraîchir les données');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Toggle l'expansion d'un mois
  const toggleMonth = (monthId: number) => {
    setExpandedMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(monthId)) {
        newSet.delete(monthId);
      } else {
        newSet.add(monthId);
      }
      return newSet;
    });
  };

  // Formater la date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Formater le montant
  const formatAmount = (amount: number): string => {
    return `${amount.toFixed(2)} DH`;
  };

  // Extraire les années disponibles des mois
  const getAvailableYears = (): string[] => {
    if (!expenseAccount?.month_ids) return [];

    const years = new Set<string>();
    expenseAccount.month_ids.forEach(month => {
      // Format du nom: "MM/YYYY" (ex: "10/2025")
      const match = month.name.match(/\/(\d{4})$/);
      if (match) {
        years.add(match[1]);
      }
    });

    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a)); // Trier par ordre décroissant
  };

  // Filtrer les mois par année
  const filterMonthsByYear = (months: ExpenseMonth[]): ExpenseMonth[] => {
    if (selectedYear === 'all') return months;

    return months.filter(month => {
      const match = month.name.match(/\/(\d{4})$/);
      return match && match[1] === selectedYear;
    });
  };

  // Filtrer les transactions par recherche
  const filterTransactions = (transactions: ExpenseTransaction[]) => {
    if (!searchQuery.trim()) return transactions;

    const query = searchQuery.toLowerCase();
    return transactions.filter(transaction => {
      const name = transaction.name?.toLowerCase() || '';
      const description = transaction.description ? transaction.description.toString().toLowerCase() : '';
      const amount = transaction.solde_amount.toString();
      const projectName = transaction.project_id && Array.isArray(transaction.project_id)
        ? transaction.project_id[1].toLowerCase()
        : '';
      const taskName = transaction.task_id && Array.isArray(transaction.task_id)
        ? transaction.task_id[1].toLowerCase()
        : '';

      return (
        name.includes(query) ||
        description.includes(query) ||
        amount.includes(query) ||
        projectName.includes(query) ||
        taskName.includes(query)
      );
    });
  };

  // Rendu d'une transaction
  const renderTransaction = (transaction: ExpenseTransaction) => {
    const isSpent = transaction.expense_move_type === 'spent';
    const amount = Math.abs(transaction.solde_amount);

    return (
      <View key={transaction.id} style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <View style={isSpent ? styles.spentIcon : styles.replenishIcon}>
            <Ionicons
              name={isSpent ? 'arrow-down-circle' : 'arrow-up-circle'}
              size={20}
              color={isSpent ? '#ef4444' : '#10b981'}
            />
          </View>
          <View style={styles.transactionInfo}>
            <Text style={styles.transactionName}>{transaction.display_name || transaction.name}</Text>
            <Text style={styles.transactionDate}>{formatDate(transaction.date)}</Text>
            
            {/* Projet et Tâche */}
            {transaction.project_id && Array.isArray(transaction.project_id) && (
              <Text style={styles.transactionDetail}>
                <Ionicons name="briefcase-outline" size={12} color="#6b7280" /> {transaction.project_id[1]}
              </Text>
            )}
            {transaction.task_id && Array.isArray(transaction.task_id) && (
              <Text style={styles.transactionDetail}>
                <Ionicons name="checkbox-outline" size={12} color="#6b7280" /> {transaction.task_id[1]}
              </Text>
            )}
            
            {/* Type et Catégorie de dépense */}
            {transaction.expense_type_id && Array.isArray(transaction.expense_type_id) && (
              <Text style={styles.transactionDetail}>
                <Ionicons name="pricetag-outline" size={12} color="#6b7280" /> {transaction.expense_type_id[1]}
              </Text>
            )}
            {transaction.expense_category_id && Array.isArray(transaction.expense_category_id) && (
              <Text style={styles.transactionDetail}>
                <Ionicons name="folder-outline" size={12} color="#6b7280" /> {transaction.expense_category_id[1]}
              </Text>
            )}
          </View>
          <Text style={[styles.transactionAmount, isSpent ? styles.amountNegative : styles.amountPositive]}>
            {isSpent ? '-' : '+'}{formatAmount(amount)}
          </Text>
        </View>
        
        {/* Description */}
        {transaction.description && transaction.description !== false && (
          <Text style={styles.transactionDescription} numberOfLines={2}>
            {transaction.description.toString()}
          </Text>
        )}
      </View>
    );
  };

  // Rendu d'un mois
  const renderMonth = (month: ExpenseMonth) => {
    const isExpanded = expandedMonths.has(month.id);
    const filteredTransactions = filterTransactions(month.transaction_ids || []);
    
    // Calculer les totaux pour ce mois
    const totalSpent = (month.transaction_ids || [])
      .filter(t => t.expense_move_type === 'spent')
      .reduce((sum, t) => sum + Math.abs(t.solde_amount), 0);
    
    const totalReplenished = (month.transaction_ids || [])
      .filter(t => t.expense_move_type === 'replenish')
      .reduce((sum, t) => sum + t.solde_amount, 0);

    return (
      <View key={month.id} style={styles.monthCard}>
        <TouchableOpacity
          style={styles.monthHeader}
          onPress={() => toggleMonth(month.id)}
          activeOpacity={0.7}
        >
          <View style={styles.monthHeaderLeft}>
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={24}
              color="#3b82f6"
            />
            <View style={styles.monthInfo}>
              <Text style={styles.monthName}>{month.display_name}</Text>
              <Text style={styles.monthTransactions}>
                {filteredTransactions.length} transaction{filteredTransactions.length > 1 ? 's' : ''}
              </Text>
            </View>
          </View>
          <View style={styles.monthHeaderRight}>
            <Text style={[styles.monthSold, month.sold < 0 ? styles.negativeValue : styles.positiveValue]}>
              {formatAmount(month.sold)}
            </Text>
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.monthContent}>
            {/* Résumé du mois */}
            <View style={styles.monthSummary}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Solde initial</Text>
                  <Text style={styles.summaryValue}>{formatAmount(month.solde_initial)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Solde final</Text>
                  <Text style={styles.summaryValue}>{formatAmount(month.solde_final)}</Text>
                </View>
              </View>
              
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Ionicons name="arrow-down-circle" size={16} color="#ef4444" />
                  <Text style={styles.summaryLabel}>Dépenses</Text>
                  <Text style={[styles.summaryValue, styles.negativeValue]}>-{formatAmount(totalSpent)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Ionicons name="arrow-up-circle" size={16} color="#10b981" />
                  <Text style={styles.summaryLabel}>Alimentations</Text>
                  <Text style={[styles.summaryValue, styles.positiveValue]}>+{formatAmount(totalReplenished)}</Text>
                </View>
              </View>
            </View>

            {/* Transactions */}
            {filteredTransactions.length > 0 ? (
              <View style={styles.transactionsContainer}>
                {filteredTransactions.map(renderTransaction)}
              </View>
            ) : (
              <View style={styles.emptyTransactions}>
                <Ionicons name="document-outline" size={48} color="#9ca3af" />
                <Text style={styles.emptyText}>
                  {searchQuery ? 'Aucune transaction trouvée' : 'Aucune transaction'}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mes Dépenses Mensuelles</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Chargement des données...</Text>
        </View>
      </View>
    );
  }

  if (!expenseAccount) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mes Dépenses Mensuelles</Text>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#ef4444" />
          <Text style={styles.errorText}>Aucun compte de dépenses disponible</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadExpenseAccount()}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Filtrer les mois par année sélectionnée
  const filteredMonths = filterMonthsByYear(expenseAccount.month_ids || []);
  
  // Calculer les statistiques basées sur les mois filtrés
  const calculateFilteredStats = () => {
    let totalTransactions = 0;
    let totalSpent = 0;
    let totalReplenished = 0;

    filteredMonths.forEach(month => {
      if (month.transaction_ids) {
        totalTransactions += month.transaction_ids.length;
        
        month.transaction_ids.forEach(transaction => {
          if (transaction.expense_move_type === 'spent') {
            totalSpent += Math.abs(transaction.solde_amount);
          } else if (transaction.expense_move_type === 'replenish') {
            totalReplenished += transaction.solde_amount;
          }
        });
      }
    });

    return {
      totalMonths: filteredMonths.length,
      totalTransactions,
      totalSpent,
      totalReplenished,
      currentBalance: totalReplenished - totalSpent
    };
  };

  const stats = calculateFilteredStats();
  const availableYears = getAvailableYears();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

      {/* Fixed Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mes Dépenses Mensuelles</Text>
        <Text style={styles.headerSubtitle}>{expenseAccount.display_name}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Stats Card */}
        <View style={styles.statsSection}>
          <View style={styles.statsCard}>
            <Text style={styles.statsTitle}>
              {selectedYear === 'all' ? 'Résumé Global' : `Résumé ${selectedYear}`}
            </Text>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Ionicons name="calendar-outline" size={24} color="#3b82f6" />
                <Text style={styles.statValue}>{stats.totalMonths}</Text>
                <Text style={styles.statLabel}>Mois</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="document-text-outline" size={24} color="#8b5cf6" />
                <Text style={styles.statValue}>{stats.totalTransactions}</Text>
                <Text style={styles.statLabel}>Transactions</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="arrow-down-circle" size={24} color="#ef4444" />
                <Text style={styles.statValue}>{formatAmount(stats.totalSpent)}</Text>
                <Text style={styles.statLabel}>Dépensé</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="arrow-up-circle" size={24} color="#10b981" />
                <Text style={styles.statValue}>{formatAmount(stats.totalReplenished)}</Text>
                <Text style={styles.statLabel}>Alimenté</Text>
              </View>
            </View>
            
            {/* Solde actuel */}
            <View style={[styles.currentBalance, stats.currentBalance < 0 ? styles.negativeBalance : styles.positiveBalance]}>
              <Text style={styles.balanceLabel}>Solde Actuel</Text>
              <Text style={styles.balanceAmount}>{formatAmount(stats.currentBalance)}</Text>
            </View>
          </View>
        </View>

        {/* Filtres par année */}
        {availableYears.length > 0 && (
          <View style={styles.yearFiltersContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearFiltersScroll}>
              <TouchableOpacity
                style={[styles.yearFilterChip, selectedYear === 'all' && styles.yearFilterChipActive]}
                onPress={() => setSelectedYear('all')}
              >
                <Ionicons 
                  name="time-outline" 
                  size={16} 
                  color={selectedYear === 'all' ? '#ffffff' : '#6b7280'} 
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.yearFilterText, selectedYear === 'all' && styles.yearFilterTextActive]}>
                  Toutes les années
                </Text>
              </TouchableOpacity>

              {availableYears.map(year => (
                <TouchableOpacity
                  key={year}
                  style={[styles.yearFilterChip, selectedYear === year && styles.yearFilterChipActive]}
                  onPress={() => setSelectedYear(year)}
                >
                  <Ionicons 
                    name="calendar-outline" 
                    size={16} 
                    color={selectedYear === year ? '#ffffff' : '#6b7280'} 
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.yearFilterText, selectedYear === year && styles.yearFilterTextActive]}>
                    {year}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Barre de recherche */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher une transaction..."
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <Ionicons name="close-circle" size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Liste des mois */}
        <View style={styles.monthsContainer}>
          {filteredMonths.length > 0 ? (
            filteredMonths.map(renderMonth)
          ) : (
            searchQuery || selectedYear !== 'all' ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={64} color="#9ca3af" />
                <Text style={styles.emptyText}>Aucun mois trouvé</Text>
                <Text style={styles.emptySubtext}>Essayez de changer les filtres</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={64} color="#9ca3af" />
                <Text style={styles.emptyText}>Aucun mois disponible</Text>
              </View>
            )
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6'
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff'
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#ffffff',
    opacity: 0.9,
    marginTop: 4
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingTop: 140,
    paddingBottom: 20
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280'
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  errorText: {
    marginTop: 16,
    fontSize: 18,
    color: '#6b7280',
    textAlign: 'center'
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#3b82f6',
    borderRadius: 8
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },
  statsSection: {
    padding: 16
  },
  statsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  statItem: {
    width: '48%',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 8
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4
  },
  currentBalance: {
    borderRadius: 8,
    padding: 16,
    alignItems: 'center'
  },
  positiveBalance: {
    backgroundColor: '#d1fae5'
  },
  negativeBalance: {
    backgroundColor: '#fee2e2'
  },
  balanceLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827'
  },
  yearFiltersContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 12
  },
  yearFiltersScroll: {
    paddingHorizontal: 16,
    gap: 8
  },
  yearFilterChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center'
  },
  yearFilterChipActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6'
  },
  yearFilterText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280'
  },
  yearFilterTextActive: {
    color: '#ffffff',
    fontWeight: '700'
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6'
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827'
  },
  clearButton: {
    padding: 4
  },
  monthsContainer: {
    padding: 16
  },
  monthCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f1f5f9'
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16
  },
  monthHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  monthInfo: {
    marginLeft: 12,
    flex: 1
  },
  monthName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2
  },
  monthTransactions: {
    fontSize: 12,
    color: '#6b7280'
  },
  monthHeaderRight: {
    alignItems: 'flex-end'
  },
  monthSold: {
    fontSize: 18,
    fontWeight: 'bold'
  },
  negativeValue: {
    color: '#ef4444'
  },
  positiveValue: {
    color: '#10b981'
  },
  monthContent: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb'
  },
  monthSummary: {
    padding: 16,
    backgroundColor: '#f9fafb'
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center'
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 2
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e5e7eb'
  },
  transactionsContainer: {
    padding: 16
  },
  transactionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  spentIcon: {
    marginRight: 12
  },
  replenishIcon: {
    marginRight: 12
  },
  transactionInfo: {
    flex: 1
  },
  transactionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2
  },
  transactionDate: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 4
  },
  transactionDetail: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  amountNegative: {
    color: '#ef4444'
  },
  amountPositive: {
    color: '#10b981'
  },
  transactionDescription: {
    marginTop: 8,
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 16
  },
  emptyTransactions: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af'
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    color: '#9ca3af'
  }
});
