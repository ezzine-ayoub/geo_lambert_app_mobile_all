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
  Modal,
  Platform,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useUserAuth } from '../../contexts/UserAuthContext';
import cashboxService, { 
  CashboxData, 
  CashboxExpense, 
  CashboxSettlement,
  subscribeToCashboxUpdates,
  subscribeToCashboxCleared
} from '../../services/cashboxService';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'expenses' | 'settlements';

export default function DetailsSoldeScreen() {
  const { userAuth } = useUserAuth();
  const [cashboxData, setCashboxData] = useState<CashboxData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('expenses');

  // ✅ États pour les filtres
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  
  // États pour le filtre de période personnalisé
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'start' | 'end'>('start');
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);

  // Charger les données de la caisse
  const loadCashboxData = useCallback(async (showLoader = true) => {
    if (!userAuth?.user_info?.employee_id) {
      Alert.alert('Erreur', 'Identifiant employé manquant');
      setIsLoading(false);
      return;
    }

    try {
      if (showLoader) {
        setIsLoading(true);
      }

      // ✅ Utiliser employee_id au lieu de case_id
      const employeeId = parseInt(userAuth.user_info.employee_id);
      const response = await cashboxService.getCashboxData(employeeId);

      if (response.success && response.result && response.result.length > 0) {
        setCashboxData(response.result[0]);
      } else {
        Alert.alert('Erreur', response.message || 'Impossible de charger les données de la caisse');
      }
    } catch (error) {
      console.error('❌ Erreur chargement caisse:', error);
      Alert.alert('Erreur', 'Impossible de charger les données');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [userAuth]);

  // Charger au démarrage
  useEffect(() => {
    loadCashboxData();
  }, [loadCashboxData]);

  // S'abonner aux mises à jour EventEmitter local (déclenché par WebSocket dans le layout)
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour cashbox (EventEmitter)...');

    const unsubscribeUpdate = subscribeToCashboxUpdates((updatedCashbox) => {
      console.log('🔄 Cashbox mise à jour via EventEmitter:', updatedCashbox.id);
      setCashboxData(updatedCashbox);
    });

    const unsubscribeCleared = subscribeToCashboxCleared(() => {
      console.log('🗑️ Cache cashbox vidé');
      setCashboxData(null);
    });

    return () => {
      console.log('🧹 Désabonnement EventEmitter cashbox');
      unsubscribeUpdate();
      unsubscribeCleared();
    };
  }, []);

  // Pull to refresh - Force refresh depuis API
  const handleRefresh = useCallback(async () => {
    if (!userAuth?.user_info?.employee_id) {
      return;
    }

    setIsRefreshing(true);

    try {
      console.log('🔄 Force refresh cashbox depuis API...');
      const employeeId = parseInt(userAuth.user_info.employee_id);
      const response = await cashboxService.forceRefreshCashbox(employeeId);

      if (response.success && response.result && response.result.length > 0) {
        setCashboxData(response.result[0]);
        console.log('✅ Cashbox refreshée avec succès');
      } else {
        Alert.alert('Erreur', response.message || 'Impossible de rafraîchir les données');
      }
    } catch (error) {
      console.error('❌ Erreur force refresh:', error);
      Alert.alert('Erreur', 'Impossible de rafraîchir les données');
    } finally {
      setIsRefreshing(false);
    }
  }, [userAuth]);

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

  // ✅ Function pour enlever les balises HTML
  const stripHtmlTags = (html: string): string => {
    if (!html) return '';
    // Remplacer les <br> par des espaces
    let text = html.replace(/<br\s*\/?>/gi, ' ');
    // Remplacer les </p> par des espaces
    text = text.replace(/<\/p>/gi, ' ');
    // Enlever toutes les autres balises HTML
    text = text.replace(/<[^>]*>/g, '');
    // Décoder les entités HTML communes
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    // Nettoyer les espaces multiples
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  };

  // ✅ Fonction pour extraire le montant correct d'une dépense (priorité: solde_amount > amount > balance)
  const getExpenseAmount = (expense: CashboxExpense): number => {
    // Priorité 1: solde_amount
    if (expense.solde_amount !== undefined && expense.solde_amount !== null) {
      return Math.abs(expense.solde_amount);
    }
    // Priorité 2: amount
    if (expense.amount !== undefined && expense.amount !== null) {
      return Math.abs(expense.amount);
    }
    // Priorité 3: balance
    if (expense.balance !== undefined && expense.balance !== null) {
      return Math.abs(expense.balance);
    }
    return 0;
  };

  // ✅ Fonction pour extraire le montant correct d'une alimentation (priorité: solde_amount > amount > balance)
  const getSettlementAmount = (settlement: CashboxSettlement): number => {
    // Priorité 1: solde_amount
    if (settlement.solde_amount !== undefined && settlement.solde_amount !== null) {
      return Math.abs(settlement.solde_amount);
    }
    // Priorité 2: amount
    if (settlement.amount !== undefined && settlement.amount !== null) {
      return Math.abs(settlement.amount);
    }
    // Priorité 3: balance
    if (settlement.balance !== undefined && settlement.balance !== null) {
      return Math.abs(settlement.balance);
    }
    return 0;
  };

  // ✅ Fonction pour obtenir la date correcte (priorité: date > expense_date > create_date)
  const getDate = (item: CashboxExpense | CashboxSettlement): string => {
    // @ts-ignore
    return item.date || item.expense_date || item.create_date || '';
  };

  // ✅ Fonction pour filtrer par date
  const filterByDate = (item: CashboxExpense | CashboxSettlement) => {
    if (dateFilter === 'all') return true;

    const itemDate = new Date(getDate(item));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (dateFilter) {
      case 'today':
        const itemDateOnly = new Date(itemDate);
        itemDateOnly.setHours(0, 0, 0, 0);
        return itemDateOnly.getTime() === today.getTime();

      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return itemDate >= weekAgo;

      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return itemDate >= monthAgo;

      case 'custom':
        if (!customStartDate) return true;
        const itemDateOnly2 = new Date(itemDate);
        itemDateOnly2.setHours(0, 0, 0, 0);
        const startDate = new Date(customStartDate);
        startDate.setHours(0, 0, 0, 0);
        
        if (customEndDate) {
          const endDate = new Date(customEndDate);
          endDate.setHours(23, 59, 59, 999);
          return itemDateOnly2 >= startDate && itemDateOnly2 <= endDate;
        }
        return itemDateOnly2 >= startDate;

      default:
        return true;
    }
  };

  // Gérer le changement de date dans le picker
  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }

    if (selectedDate) {
      if (datePickerMode === 'start') {
        setCustomStartDate(selectedDate);
        // Si date de fin existe et est avant la nouvelle date de début, la réinitialiser
        if (customEndDate && selectedDate > customEndDate) {
          setCustomEndDate(null);
        }
      } else {
        setCustomEndDate(selectedDate);
      }
    }
  };

  // Ouvrir le picker de date
  const openDatePicker = (mode: 'start' | 'end') => {
    setDatePickerMode(mode);
    if (Platform.OS === 'ios') {
      setShowDatePicker(true);
    } else {
      setShowDatePicker(true);
    }
  };

  // Appliquer la période personnalisée
  const applyCustomPeriod = () => {
    if (customStartDate) {
      setDateFilter('custom');
      setShowCustomDateModal(false);
    } else {
      Alert.alert('Erreur', 'Veuillez sélectionner au moins une date de début');
    }
  };

  // Réinitialiser la période personnalisée
  const resetCustomPeriod = () => {
    setCustomStartDate(null);
    setCustomEndDate(null);
    setDateFilter('all');
    setShowCustomDateModal(false);
  };

  // Formater la période personnalisée pour l'affichage
  const getCustomPeriodLabel = () => {
    if (!customStartDate) return 'Période personnalisée';
    const formatDateLabel = (date: Date) => {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    };
    if (customEndDate) {
      return `${formatDateLabel(customStartDate)} - ${formatDateLabel(customEndDate)}`;
    }
    return `Depuis ${formatDateLabel(customStartDate)}`;
  };

  // ✅ Fonction pour filtrer par recherche
  const filterBySearch = (item: CashboxExpense | CashboxSettlement) => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const taskName = item.task_id && Array.isArray(item.task_id) && item.task_id.length > 1
      ? item.task_id[1].toLowerCase()
      : item.name?.toLowerCase() || '';

    const amount = (item.solde_amount ?? item.amount ?? item.balance ?? 0).toString();
    const description = item.description ? item.description.toString().toLowerCase() : '';

    return (
      taskName.includes(query) ||
      amount.includes(query) ||
      description.includes(query) ||
      item.id.toString().includes(query)
    );
  };

  // ✅ Appliquer tous les filtres
  const applyFilters = (items: CashboxExpense[] | CashboxSettlement[]) => {
    return items.filter(item => filterByDate(item) && filterBySearch(item));
  };

  // Rendu d'une dépense
  const renderExpense = (expense: CashboxExpense) => {
    // ✅ task_id peut être [id, name] ou false
    const taskName = expense.task_id && Array.isArray(expense.task_id) && expense.task_id.length > 1
      ? expense.task_id[1]  // Prendre le nom (deuxième élément)
      : expense.name || 'Dépense';

    return (
      <View key={expense.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.expenseIcon}>
            <Ionicons name="arrow-down-circle" size={24} color="#ef4444" />
          </View>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.cardTitle}>{taskName}</Text>
            <Text style={styles.cardDate}>{formatDate(getDate(expense))}</Text>
          </View>
          {/* ✅ Utiliser getExpenseAmount pour obtenir le montant correct */}
          <Text style={styles.amountNegative}>{formatAmount(getExpenseAmount(expense))}</Text>
        </View>
        {expense.description && expense.description !== false && (
          <Text style={styles.cardDescription} numberOfLines={2}>{stripHtmlTags(expense.description.toString())}</Text>
        )}
      </View>
    );
  };

  // Rendu d'une alimentation (✅ Remplacé "Règlement" par "Alimentation")
  const renderSettlement = (settlement: CashboxSettlement) => {
    // ✅ task_id peut être [id, name] ou false
    const taskName = settlement.task_id && Array.isArray(settlement.task_id) && settlement.task_id.length > 1
      ? settlement.task_id[1]  // Prendre le nom (deuxième élément)
      : settlement.name || 'Alimentation';

    return (
      <View key={settlement.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.settlementIcon}>
            <Ionicons name="arrow-up-circle" size={24} color="#10b981" />
          </View>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.cardTitle}>{taskName}</Text>
            <Text style={styles.cardDate}>{formatDate(getDate(settlement))}</Text>
          </View>
          {/* ✅ Utiliser getSettlementAmount pour obtenir le montant correct */}
          <Text style={styles.amountPositive}>{formatAmount(getSettlementAmount(settlement))}</Text>
        </View>
        {settlement.description && settlement.description !== false && (
          <Text style={styles.cardDescription} numberOfLines={2}>{stripHtmlTags(settlement.description.toString())}</Text>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Détails du Solde</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Chargement des données...</Text>
        </View>
      </View>
    );
  }

  if (!cashboxData) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Détails du Solde</Text>
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#ef4444" />
          <Text style={styles.errorText}>Aucune donnée de caisse disponible</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadCashboxData()}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ✅ Calculer les stats basées sur les filtres
  const filteredExpenses = applyFilters(cashboxData.expense_ids || []);
  const filteredSettlements = applyFilters(cashboxData.settlement_ids || []);

  const filteredTotalExpenses = filteredExpenses.reduce((sum, expense) => sum + getExpenseAmount(expense), 0);
  const filteredTotalSettlements = filteredSettlements.reduce((sum, settlement) => sum + getSettlementAmount(settlement), 0);
  const filteredBalance = filteredTotalSettlements - filteredTotalExpenses;

  // 🎨 Déterminer la couleur du solde
  const isNegativeBalance = filteredBalance < 0;
  const balanceCardStyle = isNegativeBalance ? styles.balanceCardNegative : styles.balanceCardPositive;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

      {/* Fixed Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Détails du Solde</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Balance Card */}
        <View style={styles.balanceSection}>
          <View style={[styles.balanceCard, balanceCardStyle]}>
            <Text style={styles.balanceLabel}>Solde Actuel</Text>
            <Text style={styles.balanceAmount}>{formatAmount(filteredBalance)}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Dépenses</Text>
                <Text style={styles.statValue}>-{formatAmount(filteredTotalExpenses)}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Alimentations</Text>
                <Text style={styles.statValue}>+{formatAmount(filteredTotalSettlements)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Barre de recherche */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher..."
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

        {/* Filtres de date */}
        <View style={styles.dateFiltersContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateFiltersScroll}>
            <TouchableOpacity
              style={[styles.dateFilterChip, dateFilter === 'all' && styles.dateFilterChipActive]}
              onPress={() => setDateFilter('all')}
            >
              <Text style={[styles.dateFilterText, dateFilter === 'all' && styles.dateFilterTextActive]}>
                Tout
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterChip, dateFilter === 'today' && styles.dateFilterChipActive]}
              onPress={() => setDateFilter('today')}
            >
              <Text style={[styles.dateFilterText, dateFilter === 'today' && styles.dateFilterTextActive]}>
                Aujourd'hui
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterChip, dateFilter === 'week' && styles.dateFilterChipActive]}
              onPress={() => setDateFilter('week')}
            >
              <Text style={[styles.dateFilterText, dateFilter === 'week' && styles.dateFilterTextActive]}>
                7 derniers jours
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterChip, dateFilter === 'month' && styles.dateFilterChipActive]}
              onPress={() => setDateFilter('month')}
            >
              <Text style={[styles.dateFilterText, dateFilter === 'month' && styles.dateFilterTextActive]}>
                30 derniers jours
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterChip, dateFilter === 'custom' && styles.dateFilterChipActive]}
              onPress={() => setShowCustomDateModal(true)}
            >
              <Ionicons 
                name="calendar-outline" 
                size={16} 
                color={dateFilter === 'custom' ? '#ffffff' : '#6b7280'} 
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.dateFilterText, dateFilter === 'custom' && styles.dateFilterTextActive]}>
                {dateFilter === 'custom' ? getCustomPeriodLabel() : 'Période personnalisée'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Modal pour la période personnalisée */}
        <Modal
          visible={showCustomDateModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCustomDateModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Sélectionner une période</Text>
                <TouchableOpacity onPress={() => setShowCustomDateModal(false)}>
                  <Ionicons name="close" size={24} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <View style={styles.dateSelectionContainer}>
                {/* Date de début */}
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => openDatePicker('start')}
                >
                  <View style={styles.dateButtonContent}>
                    <Ionicons name="calendar-outline" size={20} color="#3b82f6" />
                    <View style={styles.dateButtonText}>
                      <Text style={styles.dateButtonLabel}>Date de début</Text>
                      <Text style={styles.dateButtonValue}>
                        {customStartDate
                          ? customStartDate.toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric'
                            })
                          : 'Sélectionner'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Date de fin */}
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => openDatePicker('end')}
                  disabled={!customStartDate}
                >
                  <View style={[styles.dateButtonContent, !customStartDate && styles.dateButtonDisabled]}>
                    <Ionicons 
                      name="calendar-outline" 
                      size={20} 
                      color={customStartDate ? '#3b82f6' : '#d1d5db'} 
                    />
                    <View style={styles.dateButtonText}>
                      <Text style={[styles.dateButtonLabel, !customStartDate && styles.dateButtonLabelDisabled]}>
                        Date de fin (optionnelle)
                      </Text>
                      <Text style={[styles.dateButtonValue, !customStartDate && styles.dateButtonValueDisabled]}>
                        {customEndDate
                          ? customEndDate.toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric'
                            })
                          : 'Sélectionner'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {/* DateTimePicker intégré pour iOS */}
                {showDatePicker && Platform.OS === 'ios' && (
                  <View style={styles.iosDatePickerContainer}>
                    <DateTimePicker
                      value={datePickerMode === 'start' ? (customStartDate || new Date()) : (customEndDate || new Date())}
                      mode="date"
                      display="spinner"
                      onChange={handleDateChange}
                      maximumDate={new Date()}
                      minimumDate={datePickerMode === 'end' && customStartDate ? customStartDate : undefined}
                      style={{ backgroundColor: 'white' }}
                    />
                  </View>
                )}
              </View>

              {/* Boutons d'action */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSecondary]}
                  onPress={resetCustomPeriod}
                >
                  <Text style={styles.modalButtonTextSecondary}>Réinitialiser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonPrimary]}
                  onPress={applyCustomPeriod}
                >
                  <Text style={styles.modalButtonTextPrimary}>Appliquer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* DateTimePicker pour Android */}
        {showDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={datePickerMode === 'start' ? (customStartDate || new Date()) : (customEndDate || new Date())}
            mode="date"
            display="default"
            onChange={handleDateChange}
            maximumDate={new Date()}
            minimumDate={datePickerMode === 'end' && customStartDate ? customStartDate : undefined}
          />
        )}

        {/* Tabs */}
        <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'expenses' && styles.activeTab]}
          onPress={() => setActiveTab('expenses')}
        >
          <Ionicons
            name="arrow-down-circle"
            size={20}
            color={activeTab === 'expenses' ? '#3b82f6' : '#6b7280'}
          />
          <Text style={[styles.tabText, activeTab === 'expenses' && styles.activeTabText]}>
            Dépenses ({(() => {
              const filtered = applyFilters(cashboxData.expense_ids || []);
              return filtered.length;
            })()})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'settlements' && styles.activeTab]}
          onPress={() => setActiveTab('settlements')}
        >
          <Ionicons
            name="arrow-up-circle"
            size={20}
            color={activeTab === 'settlements' ? '#3b82f6' : '#6b7280'}
          />
          <Text style={[styles.tabText, activeTab === 'settlements' && styles.activeTabText]}>
            Alimentations ({(() => {
              const filtered = applyFilters(cashboxData.settlement_ids || []);
              return filtered.length;
            })()})
          </Text>
        </TouchableOpacity>
        </View>

        {/* Contenu */}
        {activeTab === 'expenses' ? (
          <>
            {(() => {
              const filteredExpenses = applyFilters(cashboxData.expense_ids || []);
              return filteredExpenses.length > 0 ? (
                filteredExpenses.map(renderExpense)
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={64} color="#9ca3af" />
                  <Text style={styles.emptyText}>
                    {searchQuery || dateFilter !== 'all' ? 'Aucune dépense trouvée' : 'Aucune dépense'}
                  </Text>
                </View>
              );
            })()}
          </>
        ) : (
          <>
            {(() => {
              const filteredSettlements = applyFilters(cashboxData.settlement_ids || []);
              return filteredSettlements.length > 0 ? (
                filteredSettlements.map(renderSettlement)
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={64} color="#9ca3af" />
                  <Text style={styles.emptyText}>
                    {searchQuery || dateFilter !== 'all' ? 'Aucune alimentation trouvée' : 'Aucune alimentation'}
                  </Text>
                </View>
              );
            })()}
          </>
        )}
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
    paddingTop: StatusBar.currentHeight || 0,
    paddingBottom: 16,
    paddingHorizontal: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 8
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingBottom: 20
  },
  balanceSection: {
    padding: 16
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

  balanceCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center'
  },
  balanceCardPositive: {
    backgroundColor: '#10b981' // Vert si solde positif
  },
  balanceCardNegative: {
    backgroundColor: '#ef4444' // Rouge si solde négatif
  },
  balanceLabel: {
    fontSize: 14,
    color: '#ffffff',
    opacity: 0.9,
    marginBottom: 8
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%'
  },
  statItem: {
    flex: 1,
    alignItems: 'center'
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#ffffff',
    opacity: 0.3
  },
  statLabel: {
    fontSize: 12,
    color: '#ffffff',
    opacity: 0.8,
    marginBottom: 4
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff'
  },
  // ✅ Styles pour la barre de recherche
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    height: 44
  },
  searchIcon: {
    marginRight: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 0
  },
  clearButton: {
    padding: 4
  },
  // ✅ Styles pour les filtres de date
  dateFiltersContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 12
  },
  dateFiltersScroll: {
    paddingHorizontal: 16,
    gap: 8
  },
  dateFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center'
  },
  dateFilterChipActive: {
    backgroundColor: '#3b82f6'
  },
  dateFilterText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280'
  },
  dateFilterTextActive: {
    color: '#ffffff',
    fontWeight: '600'
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginBottom: 16
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6'
  },
  tabText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6b7280'
  },
  activeTabText: {
    color: '#3b82f6',
    fontWeight: '600'
  },
  content: {
    flex: 1,
    padding: 16
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  expenseIcon: {
    marginRight: 12
  },
  settlementIcon: {
    marginRight: 12
  },
  cardHeaderInfo: {
    flex: 1
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4
  },
  cardDate: {
    fontSize: 12,
    color: '#6b7280'
  },
  amountNegative: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ef4444'
  },
  amountPositive: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#10b981'
  },
  cardDescription: {
    marginTop: 12,
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20
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
  // Styles pour le modal de période personnalisée
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end'
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827'
  },
  dateSelectionContainer: {
    marginBottom: 24
  },
  dateButton: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  dateButtonContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  dateButtonDisabled: {
    opacity: 0.5
  },
  dateButtonText: {
    marginLeft: 12,
    flex: 1
  },
  dateButtonLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4
  },
  dateButtonLabelDisabled: {
    color: '#d1d5db'
  },
  dateButtonValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827'
  },
  dateButtonValueDisabled: {
    color: '#d1d5db'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  modalButtonPrimary: {
    backgroundColor: '#3b82f6'
  },
  modalButtonSecondary: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  modalButtonTextPrimary: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },
  modalButtonTextSecondary: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600'
  },
  iosDatePickerContainer: {
    backgroundColor: '#ffffff',
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden'
  }
});
