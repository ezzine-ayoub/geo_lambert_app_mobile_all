import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  StatusBar,
  Dimensions,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserAuth, useCurrentUser } from '@/contexts/UserAuthContext';
import { router } from 'expo-router';
import projectCategoryService, { 
  ProjectCategory, 
  subscribeToProjectUpdates,
  subscribeToCategoryUpdates,
  subscribeToCategoriesCleared,
  subscribeToCategoryDeleted
} from '@/services/projectCategoryService';
import projectTypeService, {
  ProjectType,
  subscribeToTypeUpdates
} from '@/services/projectTypeService';
import webSocketService from '@/services/webSocketService';


const { width } = Dimensions.get('window');

// ✅ Helper function pour calculer les totaux de dépenses et alimentations
const calculateProjectFinancials = (project: any) => {
  let totalExpenses = 0;
  let totalSettlements = 0;

  if (project.tasks && Array.isArray(project.tasks)) {
    project.tasks.forEach((task: any) => {
      if (task.expense_ids && Array.isArray(task.expense_ids)) {
        task.expense_ids.forEach((expense: any) => {
          const amount = Math.abs(expense.solde_amount ?? expense.amount ?? expense.balance ?? 0);
          
          // Vérifier le type de mouvement
          if (expense.expense_move_type === 'replenish') {
            totalSettlements += amount;
          } else if (expense.expense_move_type === 'spent') {
            totalExpenses += amount;
          }
        });
      }
    });
  }

  return {
    totalExpenses,
    totalSettlements,
    balance: totalSettlements - totalExpenses
  };
};

// ✅ Helper function pour calculer les totaux d'une catégorie
const calculateCategoryFinancials = (category: ProjectCategory) => {
  let totalExpenses = 0;
  let totalSettlements = 0;

  if (category.project_ids && Array.isArray(category.project_ids)) {
    category.project_ids.forEach(project => {
      const projectFinancials = calculateProjectFinancials(project);
      totalExpenses += projectFinancials.totalExpenses;
      totalSettlements += projectFinancials.totalSettlements;
    });
  }

  return {
    totalExpenses,
    totalSettlements,
    balance: totalSettlements - totalExpenses
  };
};

export default function HomeScreen() {
  const { refreshSession, error } = useUserAuth();
  const user = useCurrentUser();
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [typeSearchQuery, setTypeSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<'all' | 'client' | 'marche_public' | 'non_defini'>('all');
  const scrollViewRef = useRef<ScrollView>(null);
  const [searchInputY, setSearchInputY] = useState(0);
  const [filterSectionY, setFilterSectionY] = useState(0);
  const [stats, setStats] = useState({
    totalCategories: 0,
    totalProjects: 0,
  });

  // ✅ Charger les données au démarrage
  useEffect(() => {
    loadCategories();
    loadProjectTypes();
  }, []);

  // 🔄 S'abonner aux mises à jour des catégories
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour de catégories...');
    
    const unsubscribe = subscribeToCategoryUpdates((updatedCategories) => {
      console.log('🔄 Catégories mises à jour via événement');
      
      // ✅ Utiliser directement les données de l'event (déjà filtrées)
      setCategories(updatedCategories);
      calculateStats(updatedCategories);
      
      // 🆕 Si une catégorie est sélectionnée, la mettre à jour aussi
      if (selectedCategory) {
        const updatedSelectedCategory = updatedCategories.find(cat => cat.id === selectedCategory.id);
        if (updatedSelectedCategory) {
          console.log('✅ Catégorie sélectionnée mise à jour via event:', updatedSelectedCategory.name);
          setSelectedCategory(updatedSelectedCategory);
        } else {
          console.warn('⚠️ Catégorie sélectionnée non trouvée dans les mises à jour');
          setSelectedCategory(null);
        }
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour de catégories');
      unsubscribe();
    };
  }, [selectedCategory]);

  // 🔔 S'abonner aux mises à jour WebSocket de PROJETS INDIVIDUELS
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour de projets individuels (index - WebSocket)...');
    
    const unsubscribe = subscribeToProjectUpdates((updatedProject) => {
      console.log('✅ Projet individuel mis à jour via WebSocket (index):', updatedProject.id);
      console.log('   Category ID du projet:', (updatedProject as any).category_id);
      
      // 🎯 Gérer les 3 cas: Update, Déplacement, Ajout
      setCategories(prevCategories => {
        const newCategories = [...prevCategories];
        const projectId = updatedProject.id;
        const newCategoryId = (updatedProject as any).category_id;
        
        if (!newCategoryId) {
          console.warn('⚠️ Projet sans category_id, impossible de le placer');
          return prevCategories;
        }
        
        // 🔍 ÉTAPE 1: Chercher où est le projet actuellement
        let oldCategoryIndex = -1;
        let projectIndex = -1;
        
        for (let i = 0; i < newCategories.length; i++) {
          if (newCategories[i].project_ids) {
            const idx = newCategories[i].project_ids.findIndex(p => p.id === projectId);
            if (idx >= 0) {
              oldCategoryIndex = i;
              projectIndex = idx;
              console.log(`📍 Projet ${projectId} trouvé dans la catégorie ${newCategories[i].id}`);
              break;
            }
          }
        }
        
        // 🔍 ÉTAPE 2: Trouver la catégorie de destination
        const targetCategoryIndex = newCategories.findIndex(c => c.id === newCategoryId);
        
        if (targetCategoryIndex === -1) {
          console.warn(`⚠️ Catégorie de destination ${newCategoryId} non trouvée`);
          return prevCategories;
        }
        
        // Initialiser project_ids si nécessaire
        if (!newCategories[targetCategoryIndex].project_ids) {
          newCategories[targetCategoryIndex].project_ids = [];
        }
        
        // 🎯 ÉTAPE 3: Gérer les différents cas
        if (oldCategoryIndex === -1) {
          // CAS 1: Projet n'existe pas → L'ajouter dans sa catégorie
          console.log(`➕ Ajout du nouveau projet ${projectId} dans la catégorie ${newCategoryId}`);
          newCategories[targetCategoryIndex].project_ids.push(updatedProject);
          
        } else if (newCategories[oldCategoryIndex].id === newCategoryId) {
          // CAS 2: Projet existe dans la BONNE catégorie → Le remplacer
          console.log(`♻️ Remplacement du projet ${projectId} dans la même catégorie ${newCategoryId}`);
          newCategories[targetCategoryIndex].project_ids[projectIndex] = updatedProject;
          
        } else {
          // CAS 3: Projet existe dans une AUTRE catégorie → Le déplacer
          console.log(`🔄 Déplacement du projet ${projectId} de la catégorie ${newCategories[oldCategoryIndex].id} vers ${newCategoryId}`);
          
          // Supprimer de l'ancienne catégorie
          newCategories[oldCategoryIndex].project_ids = newCategories[oldCategoryIndex].project_ids.filter(
            p => p.id !== projectId
          );
          console.log(`🗑️ Projet ${projectId} supprimé de l'ancienne catégorie`);
          
          // Ajouter dans la nouvelle catégorie
          newCategories[targetCategoryIndex].project_ids.push(updatedProject);
          console.log(`✅ Projet ${projectId} ajouté dans la nouvelle catégorie`);
        }
        
        // 🎯 TRIER les projets par create_date DESC après modification
        if (newCategories[targetCategoryIndex].project_ids) {
          newCategories[targetCategoryIndex].project_ids.sort((a, b) => {
            const dateA = a.create_date ? new Date(a.create_date).getTime() : 0;
            const dateB = b.create_date ? new Date(b.create_date).getTime() : 0;
            return dateB - dateA; // DESC: plus récent en premier
          });
        }
        
        return newCategories;
      });
      
      // ✅ Si une catégorie est sélectionnée, la mettre à jour aussi
      if (selectedCategory) {
        const newCategoryId = (updatedProject as any).category_id;
        const projectId = updatedProject.id;
        
        // Vérifier si le projet doit être dans cette catégorie
        if (newCategoryId === selectedCategory.id) {
          // Le projet DOIT être dans cette catégorie
          setSelectedCategory(prev => {
            if (!prev) return null;
            
            const existingProjectIndex = prev.project_ids.findIndex(p => p.id === projectId);
            
            let updatedProjects;
            if (existingProjectIndex >= 0) {
              // Remplacer le projet existant
              console.log('♻️ Remplacement du projet dans la catégorie sélectionnée');
              updatedProjects = prev.project_ids.map(p => 
                p.id === projectId ? updatedProject : p
              );
            } else {
              // Ajouter le nouveau projet
              console.log('➕ Ajout du projet dans la catégorie sélectionnée');
              updatedProjects = [...prev.project_ids, updatedProject];
            }
            
            // 🎯 TRIER par create_date DESC
            updatedProjects.sort((a, b) => {
              const dateA = a.create_date ? new Date(a.create_date).getTime() : 0;
              const dateB = b.create_date ? new Date(b.create_date).getTime() : 0;
              return dateB - dateA;
            });
            
            return {
              ...prev,
              project_ids: updatedProjects
            };
          });
        } else {
          // Le projet NE DOIT PAS être dans cette catégorie
          const projectInCategory = selectedCategory.project_ids.find(p => p.id === projectId);
          if (projectInCategory) {
            // Le supprimer de la catégorie sélectionnée
            console.log('🗑️ Suppression du projet de la catégorie sélectionnée (changé de catégorie)');
            setSelectedCategory(prev => {
              if (!prev) return null;
              return {
                ...prev,
                project_ids: prev.project_ids.filter(p => p.id !== projectId)
              };
            });
          }
        }
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour de projets (index)');
      unsubscribe();
    };
  }, [selectedCategory]);

  // 🗑️ S'abonner aux suppressions de catégories WebSocket
  useEffect(() => {
    console.log('🔔 Abonnement aux suppressions de catégories (index)...');
    
    const unsubscribe = subscribeToCategoryDeleted((deletedCategoryId) => {
      console.log('🗑️ Catégorie supprimée via WebSocket:', deletedCategoryId);
      
      // Si la catégorie actuelle est supprimée, revenir aux catégories
      if (selectedCategory && selectedCategory.id === deletedCategoryId) {
        console.log('⚠️ Catégorie sélectionnée supprimée, retour aux catégories');
        setSelectedCategory(null);
      }
      
      // Mettre à jour la liste des catégories
      setCategories(prevCategories => {
        const updated = prevCategories.filter(c => c.id !== deletedCategoryId);
        calculateStats(updated);
        return updated;
      });
    });
    
    return () => {
      console.log('🧹 Désabonnement des suppressions de catégories (index)');
      unsubscribe();
    };
  }, [selectedCategory]);

  // 🗑️ S'abonner au vidage du cache
  useEffect(() => {
    console.log('🔔 Abonnement au vidage du cache (index)...');
    
    const unsubscribe = subscribeToCategoriesCleared(() => {
      console.log('🗑️ Cache vidé - Données en cache supprimées');
    });
    
    return () => {
      console.log('🧹 Désabonnement du vidage du cache (index)');
      unsubscribe();
    };
  }, []);

  // 🔌 S'abonner aux mises à jour WebSocket (canal unifié)
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour WebSocket (canal unifié)...');
    
    webSocketService.onUnifiedChannelUpdate({
      onCategoryUpdate: async (updatedCategory) => {
        console.log('🔄 Catégorie mise à jour via WebSocket:', updatedCategory.id);
        
        // Recharger les catégories depuis SQLite
        const response = await projectCategoryService.getProjectCategories();
        if (response.success && response.result) {
          setCategories(response.result);
          calculateStats(response.result);
          
          // 🆕 Mettre à jour la catégorie sélectionnée si nécessaire
          if (selectedCategory) {
            const updated = response.result.find(c => c.id === selectedCategory.id);
            if (updated) {
              console.log('✅ Catégorie sélectionnée mise à jour via WebSocket canal unifié:', updated.name);
              setSelectedCategory(updated);
            } else if (selectedCategory.id === updatedCategory.id) {
              // Si la catégorie mise à jour est celle qui est sélectionnée mais n'est plus visible
              console.warn('⚠️ Catégorie sélectionnée non trouvée après mise à jour WebSocket');
              setSelectedCategory(null);
            }
          }
        }
      },
      // Les callbacks pour projet et tâche sont optionnels,
      // ils sont déjà gérés par subscribeToProjectUpdates
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour WebSocket (canal unifié)');
    };
  }, [selectedCategory]);

  // Fonction pour récupérer les types de projets
  const loadProjectTypes = async () => {
    try {
      console.log('📊 Chargement des types de projets...');
      
      const response = await projectTypeService.getProjectTypes();
      
      if (response.success && response.result) {
        setProjectTypes(response.result);
        console.log(`📊 ${response.result.length} types de projets chargés`);
      } else {
        console.warn('⚠️ Erreur service types:', response.message);
      }

    } catch (error) {
      console.error('❌ Erreur chargement types:', error);
    }
  };

  // S'abonner aux mises à jour des types
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour de types...');
    
    const unsubscribe = subscribeToTypeUpdates((updatedTypes) => {
      console.log('🔄 Types mis à jour via événement');
      setProjectTypes(updatedTypes);
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour de types');
      unsubscribe();
    };
  }, []);

  // Fonction pour récupérer les catégories
  const loadCategories = async () => {
    try {
      setLoading(true);
      console.log('📊 Chargement des catégories...');
      
      const response = await projectCategoryService.getProjectCategories();
      
      if (response.success && response.result) {
        setCategories(response.result);
        calculateStats(response.result);
        console.log(`📊 ${response.result.length} catégories chargées`);
      } else {
        console.warn('⚠️ Erreur service catégories:', response.message);
        throw new Error(response.message || 'Erreur de récupération des catégories');
      }

    } catch (error) {
      console.error('❌ Erreur chargement catégories:', error);
      if (categories.length === 0) {
        setStats({
          totalCategories: 0,
          totalProjects: 0,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (cats: ProjectCategory[]) => {
    let totalProjects = 0;

    cats.forEach(cat => {
      if (cat.project_ids && Array.isArray(cat.project_ids)) {
        totalProjects += cat.project_ids.length;
      }
    });

    setStats({
      totalCategories: cats.length,
      totalProjects,
    });
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    const startTime = Date.now();
    
    try {
      console.log('🔄 Pull-to-refresh: forçage du rafraîchissement...');
      const response = await projectCategoryService.forceRefreshCategories();
      
      if (response.success && response.result) {
        setCategories(response.result);
        calculateStats(response.result);
        
        // 🆕 Si une catégorie est sélectionnée, la mettre à jour avec les nouvelles données
        if (selectedCategory) {
          const updatedSelectedCategory = response.result.find(cat => cat.id === selectedCategory.id);
          if (updatedSelectedCategory) {
            console.log('✅ Catégorie sélectionnée mise à jour:', updatedSelectedCategory.name);
            setSelectedCategory(updatedSelectedCategory);
            
            // 🔔 Afficher un alert pour informer l'utilisateur
            Alert.alert(
              '✅ Données mises à jour',
              `Les projets de "${updatedSelectedCategory.name}" ont été actualisés avec succès.`,
              [{ text: 'OK' }]
            );
          } else {
            console.warn('⚠️ Catégorie sélectionnée non trouvée après refresh');
            // Si la catégorie n'existe plus, revenir aux catégories
            setSelectedCategory(null);
            Alert.alert(
              '⚠️ Catégorie supprimée',
              'Cette catégorie n\'existe plus. Retour à la liste des catégories.',
              [{ text: 'OK' }]
            );
          }
        } else {
          // Pas de catégorie sélectionnée, juste un message de succès
          console.log(`✅ ${response.result.length} catégories rafraîchies`);
        }
      } else {
        console.warn('⚠️ Erreur refresh:', response.message);
        Alert.alert('Erreur', response.message || 'Impossible de rafraîchir les données');
      }
      
      await refreshSession();
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
      Alert.alert('Erreur', 'Une erreur est survenue lors du rafraîchissement');
    } finally {
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsedTime);
      
      setTimeout(() => {
        setRefreshing(false);
      }, remainingTime);
    }
  }, [refreshSession, selectedCategory]);

  const scrollToCategoryList = () => {
    if (scrollViewRef.current) {
      // Hauteur du header fixe (140px) + petit espace (20px)
      const headerHeight = 160;
      
      // Si on a une section de filtrage visible (catégorie sélectionnée), scroller vers elle
      // Sinon scroller vers l'input de recherche
      const targetY = selectedCategory && filterSectionY > 0 ? filterSectionY : searchInputY;
      
      if (targetY > 0) {
        scrollViewRef.current.scrollTo({
          y: targetY - headerHeight,
          animated: true
        });
      }
    }
  };

  const StatCard = ({ icon, value, label, color = '#2563eb', onPress }) => (
    <TouchableOpacity 
      style={styles.statCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.statIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );

  const formatDate = (date) => {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatAmount = (amount: number): string => {
    return `${amount.toFixed(2)} DH`;
  };

  const handleCategoryPress = (category: ProjectCategory) => {
    console.log('📂 Catégorie sélectionnée:', category.name);
    setSelectedCategory(category);
    setSearchQuery(''); // Réinitialiser la recherche
    setSelectedYear('all'); // Réinitialiser le filtre d'année
    setSelectedSource('all'); // Réinitialiser le filtre de source
    setFilterSectionY(0); // Réinitialiser pour recalculer
  };

  const handleProjectPress = (project: any) => {
    console.log('🎯 Navigation vers projet:', project.name);
    router.push({
      pathname: '/(tabs)/project-details',
      params: {
        project: JSON.stringify(project),
        projectName: project.name
      }
    });
  };

  const handleBackToCategories = () => {
    console.log('🔙 Retour aux catégories');
    setSelectedCategory(null);
    setSearchQuery(''); // Réinitialiser la recherche
    setSelectedTypeIds([]); // Réinitialiser les filtres de type
    setTypeSearchQuery(''); // Réinitialiser la recherche de types
    setSelectedYear('all'); // Réinitialiser le filtre d'année
    setSelectedSource('all'); // Réinitialiser le filtre de source
    setFilterSectionY(0); // Réinitialiser la position du filtre
  };

  const toggleTypeFilter = (typeId: number) => {
    setSelectedTypeIds(prev => {
      if (prev.includes(typeId)) {
        return prev.filter(id => id !== typeId);
      } else {
        return [...prev, typeId];
      }
    });
  };

  // Extraire les années disponibles des projets
  const getAvailableYears = (): string[] => {
    if (!selectedCategory?.project_ids) return [];

    const years = new Set<string>();
    selectedCategory.project_ids.forEach(project => {
      // Utiliser create_date pour extraire l'année
      const dateString = project.create_date;
      if (dateString && dateString !== false) {
        try {
          const date = new Date(dateString);
          if (!isNaN(date.getTime())) {
            years.add(date.getFullYear().toString());
          }
        } catch (e) {
          // Ignorer les dates invalides
        }
      }
    });

    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a)); // Trier par ordre décroissant
  };

  // Filtrer les projets par année
  const filterProjectsByYear = (projects: any[]): any[] => {
    if (selectedYear === 'all') return projects;

    return projects.filter(project => {
      const dateString = project.create_date;
      if (!dateString || dateString === false) return false;

      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return false;
        return date.getFullYear().toString() === selectedYear;
      } catch (e) {
        return false;
      }
    });
  };

  // Filtrer les projets par source
  const filterProjectsBySource = (projects: any[]): any[] => {
    if (selectedSource === 'all') return projects;

    return projects.filter(project => {
      if (selectedSource === 'client') {
        return project.project_source === 'client';
      } else if (selectedSource === 'marche_public') {
        return project.project_source === 'marche_public';
      } else if (selectedSource === 'non_defini') {
        return project.project_source === false || project.project_source === undefined || project.project_source === null;
      }
      return true;
    });
  };

  // 🎯 Trier les projets par create_date DESC (plus récents en premier)
  const sortProjectsByDate = (projects: any[]): any[] => {
    return [...projects].sort((a, b) => {
      const dateA = a.create_date ? new Date(a.create_date).getTime() : 0;
      const dateB = b.create_date ? new Date(b.create_date).getTime() : 0;
      return dateB - dateA; // DESC: plus récent en premier
    });
  };

  // Filtrer les types selon la recherche
  const getFilteredTypes = () => {
    // Exclure les types déjà sélectionnés de la liste
    let availableTypes = projectTypes.filter(type => !selectedTypeIds.includes(type.id));
    
    if (!typeSearchQuery.trim()) {
      return availableTypes;
    }
    
    const query = typeSearchQuery.toLowerCase().trim();
    return availableTypes.filter(type => 
      type.name.toLowerCase().includes(query) ||
      type.display_name.toLowerCase().includes(query)
    );
  };

  // Récupérer les types sélectionnés
  const getSelectedTypes = () => {
    return projectTypes.filter(type => selectedTypeIds.includes(type.id));
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  // ✨ Palette de couleurs qui alterne pour les catégories
  const categoryColorPalette = [
    '#8b5cf6', // Violet
    '#3b82f6', // Bleu
    '#10b981', // Vert
    '#f59e0b', // Orange
    '#ef4444', // Rouge
    '#06b6d4', // Cyan
    '#ec4899', // Rose
  ];

  // Fonction pour obtenir une couleur basée sur l'INDEX de la catégorie dans le tableau
  // ✅ Garantit que 2 catégories consécutives n'ont jamais la même couleur
  const getCategoryColorByIndex = (index: number) => {
    const colorIndex = index % categoryColorPalette.length;
    return categoryColorPalette[colorIndex];
  };

  // Filtrer les projets selon la recherche, les types, l'année ET la source, puis TRIER par date
  const getFilteredProjects = () => {
    if (!selectedCategory || !selectedCategory.project_ids) return [];
    
    let filtered = selectedCategory.project_ids;

    // Filtre par année
    filtered = filterProjectsByYear(filtered);

    // Filtre par source
    filtered = filterProjectsBySource(filtered);

    // Filtre par type
    if (selectedTypeIds.length > 0) {
      filtered = filtered.filter(project => 
        project.type_ids && project.type_ids.some(type => selectedTypeIds.includes(type.id))
      );
    }
    
    // Filtre par recherche
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(project => 
        project.name.toLowerCase().includes(query) ||
        project.numero?.toString().toLowerCase().includes(query) ||
        (project.partner_id && project.partner_id[1]?.toLowerCase().includes(query))
      );
    }

    // 🎯 TRIER par create_date DESC (plus récents en premier)
    filtered = sortProjectsByDate(filtered);

    return filtered;
  };

  // Filtrer les catégories selon la recherche
  const getFilteredCategories = () => {
    if (!searchQuery.trim()) {
      return categories;
    }
    
    const query = searchQuery.toLowerCase().trim();
    return categories.filter(category => 
      category.name.toLowerCase().includes(query) ||
      category.project_ids?.some(project => 
        project.name.toLowerCase().includes(query) ||
        project.numero?.toString().toLowerCase().includes(query)
      )
    );
  };

  const filteredItems = selectedCategory ? getFilteredProjects() : getFilteredCategories();
  const availableYears = getAvailableYears();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
      
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            {selectedCategory && (
              <TouchableOpacity 
                style={styles.backButton}
                onPress={handleBackToCategories}
              >
                <Ionicons name="arrow-back" size={24} color="#ffffff" />
              </TouchableOpacity>
            )}
            <View>
              <Text style={styles.greeting}>
                {selectedCategory ? selectedCategory.name : `${getGreeting()}${user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}`}
              </Text>
              <Text style={styles.date}>{formatDate(currentTime)}</Text>
            </View>
          </View>
        </View>
      </View>
      
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={false}
            onRefresh={onRefresh}
            colors={['#2563eb', '#3b82f6']}
            tintColor="#2563eb"
            progressBackgroundColor="#ffffff"
            progressViewOffset={140}
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Company Banner */}
        <View style={styles.companyBanner}>
          <View style={styles.companyLogoContainer}>
            <Image
              source={require('../../assets/images/icons.png')}
              style={styles.companyLogo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>GEO LAMBERT</Text>
            <Text style={styles.companySlogan}>L'Art de mesure et de précision</Text>
            <View style={styles.companyMetaRow}>
              <View style={styles.companyMetaItem}>
                <Ionicons name="briefcase-outline" size={14} color="#3b82f6" />
                <Text style={styles.companyDescription}>Géomatique Pro</Text>
              </View>
              <View style={styles.companyMetaDivider} />
              <View style={styles.companyMetaItem}>
                <Ionicons name="calendar-outline" size={14} color="#3b82f6" />
                <Text style={styles.companyDescription}>Depuis 1985</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats Cards - Only show when not viewing a category */}
        {!selectedCategory && (
          <View style={styles.statsContainer}>
            <View style={styles.statsGrid}>
              <StatCard 
                icon="folder-open"
                value={stats.totalCategories}
                label="Catégories"
                color="#8b5cf6"
                onPress={scrollToCategoryList}
              />
              <StatCard 
                icon="briefcase"
                value={stats.totalProjects}
                label="Projets"
                color="#3b82f6"
                onPress={scrollToCategoryList}
              />
            </View>
          </View>
        )}

        {/* Unified Filters Section - Only show when viewing projects */}
        {selectedCategory && (
          <View style={styles.unifiedFiltersWrapper}>
            {/* Filter by Type */}
            {projectTypes.length > 0 && (
              <View 
                style={styles.filterContainer}
                onLayout={(event) => {
                  const { y } = event.nativeEvent.layout;
                  setFilterSectionY(y);
                }}
              >
                <View style={styles.filterHeader}>
                  <View style={styles.filterHeaderLeft}>
                    <Ionicons name="layers" size={16} color="#2563eb" />
                    <Text style={styles.filterTitle}>Types</Text>
                  </View>
                  {selectedTypeIds.length > 0 && (
                    <TouchableOpacity 
                      onPress={() => setSelectedTypeIds([])}
                      style={styles.clearFilterButton}
                    >
                      <Text style={styles.clearFilterText}>Effacer</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Tags des types sélectionnés */}
                {selectedTypeIds.length > 0 && (
                  <View style={styles.selectedTagsContainer}>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.selectedTagsContent}
                    >
                      {getSelectedTypes().map(type => (
                        <View key={type.id} style={styles.selectedTag}>
                          <Ionicons name="checkmark-circle" size={14} color="#ffffff" />
                          <Text style={styles.selectedTagText}>{type.name}</Text>
                          <TouchableOpacity 
                            onPress={() => toggleTypeFilter(type.id)}
                            style={styles.selectedTagRemove}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close" size={14} color="#ffffff" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}
                
                {/* Input de recherche pour les types */}
                <View style={styles.typeSearchInputContainer}>
                  <Ionicons name="search" size={18} color="#9ca3af" style={styles.typeSearchIcon} />
                  <TextInput
                    style={styles.typeSearchInput}
                    placeholder="Rechercher un type..."
                    placeholderTextColor="#9ca3af"
                    value={typeSearchQuery}
                    onChangeText={setTypeSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {typeSearchQuery.length > 0 && (
                    <TouchableOpacity 
                      onPress={() => setTypeSearchQuery('')}
                      style={styles.typeClearButton}
                    >
                      <Ionicons name="close-circle" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Chips des types disponibles (non sélectionnés) */}
                {(() => {
                  const filteredTypes = getFilteredTypes();
                  return (
                    <View style={styles.filterChipsWrapper}>
                      {filteredTypes.length > 0 ? (
                        <ScrollView 
                          horizontal 
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.filterChipsContainer}
                        >
                          {filteredTypes.map(type => (
                            <TouchableOpacity
                              key={type.id}
                              style={styles.filterChip}
                              onPress={() => toggleTypeFilter(type.id)}
                              activeOpacity={0.7}
                            >
                              <Ionicons 
                                name="add-circle-outline" 
                                size={16} 
                                color="#6b7280" 
                              />
                              <Text style={styles.filterChipText}>
                                {type.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      ) : (
                        <View style={styles.noTypesFoundContainer}>
                          <Ionicons name="search-outline" size={24} color="#9ca3af" />
                          <Text style={styles.noTypesFoundText}>
                            {selectedTypeIds.length === projectTypes.length 
                              ? 'Tous les types sont sélectionnés' 
                              : 'Aucun type trouvé'
                            }
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}
              </View>
            )}

            {/* Quick Filters Row */}
            <View style={styles.quickFiltersContainer}>

              {/* Year Filter */}
              {availableYears.length > 0 && (
                <View style={styles.quickFilterSection}>
                  <View style={styles.quickFilterHeader}>
                    <Ionicons name="calendar-outline" size={14} color="#6b7280" />
                    <Text style={styles.quickFilterLabel}>Année</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilterScroll}>
                    <TouchableOpacity
                      style={[styles.quickFilterChip, selectedYear === 'all' && styles.quickFilterChipActive]}
                      onPress={() => setSelectedYear('all')}
                    >
                      <Text style={[styles.quickFilterText, selectedYear === 'all' && styles.quickFilterTextActive]}>
                        Toutes
                      </Text>
                    </TouchableOpacity>
                    {availableYears.map(year => (
                      <TouchableOpacity
                        key={year}
                        style={[styles.quickFilterChip, selectedYear === year && styles.quickFilterChipActive]}
                        onPress={() => setSelectedYear(year)}
                      >
                        <Text style={[styles.quickFilterText, selectedYear === year && styles.quickFilterTextActive]}>
                          {year}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Source Filter */}
              <View style={styles.quickFilterSection}>
                <View style={styles.quickFilterHeader}>
                  <Ionicons name="business-outline" size={14} color="#6b7280" />
                  <Text style={styles.quickFilterLabel}>Source</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilterScroll}>
                  <TouchableOpacity
                    style={[styles.quickFilterChip, selectedSource === 'all' && styles.quickFilterChipActive]}
                    onPress={() => setSelectedSource('all')}
                  >
                    <Text style={[styles.quickFilterText, selectedSource === 'all' && styles.quickFilterTextActive]}>
                      Tous
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickFilterChip, selectedSource === 'client' && styles.quickFilterChipActive]}
                    onPress={() => setSelectedSource('client')}
                  >
                    <Text style={[styles.quickFilterText, selectedSource === 'client' && styles.quickFilterTextActive]}>
                      Privé
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickFilterChip, selectedSource === 'marche_public' && styles.quickFilterChipActive]}
                    onPress={() => setSelectedSource('marche_public')}
                  >
                    <Text style={[styles.quickFilterText, selectedSource === 'marche_public' && styles.quickFilterTextActive]}>
                      Public
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickFilterChip, selectedSource === 'non_defini' && styles.quickFilterChipActive]}
                    onPress={() => setSelectedSource('non_defini')}
                  >
                    <Text style={[styles.quickFilterText, selectedSource === 'non_defini' && styles.quickFilterTextActive]}>
                      Non défini
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </View>
        )}

        {/* Search/Filter Section */}
        <View 
          style={styles.searchContainer}
          onLayout={(event) => {
            const { y } = event.nativeEvent.layout;
            setSearchInputY(y);
          }}
        >
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={selectedCategory ? "Rechercher un projet..." : "Rechercher une catégorie..."}
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                onPress={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                <Ionicons name="close-circle" size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Main Content: Categories or Projects */}
        <View style={styles.activityContainer}>
          <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
          {selectedCategory ? `Projets - ${selectedCategory.name}` : 'Catégories'}
          {selectedYear !== 'all' && selectedCategory && ` (${selectedYear})`}
          </Text>
          {(searchQuery.trim() || selectedTypeIds.length > 0 || selectedYear !== 'all' || selectedSource !== 'all') && (
          <Text style={styles.resultCount}>
          {filteredItems.length} résultat{filteredItems.length > 1 ? 's' : ''}
          </Text>
          )}
          </View>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>
                Chargement {selectedCategory ? 'des projets' : 'des catégories'}...
              </Text>
            </View>
          ) : selectedCategory ? (
            // Afficher les projets de la catégorie sélectionnée
            filteredItems.length > 0 ? (
              (() => {
                // ✅ Trouver l'index de la catégorie sélectionnée pour garder sa couleur
                const categoryIndex = categories.findIndex(cat => cat.id === selectedCategory.id);
                const categoryColor = getCategoryColorByIndex(categoryIndex >= 0 ? categoryIndex : 0);
                
                return filteredItems.map((project: any) => {
                  const financials = calculateProjectFinancials(project);
                  return (
                    <TouchableOpacity 
                      key={project.id} 
                      style={styles.projectCard}
                      onPress={() => handleProjectPress(project)}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.projectColorBar,
                        { backgroundColor: categoryColor }
                      ]} />

                      <View style={styles.projectCardContent}>
                        <View style={styles.projectCardHeader}>
                          <View style={[
                            styles.projectIconContainer,
                            { backgroundColor: categoryColor + '15' }
                          ]}>
                            <Ionicons 
                              name="briefcase" 
                              size={22} 
                              color={categoryColor} 
                            />
                        </View>
                        <View style={styles.projectTitleContainer}>
                          <Text style={styles.projectTitle} numberOfLines={1}>{project.name}</Text>
                          <View style={styles.projectBadgesRow}>
                            {project.numero && (
                              <View style={styles.numeroChip}>
                                <Ionicons name="pricetag" size={10} color="#3b82f6" />
                                <Text style={styles.numeroText}>#{project.numero}</Text>
                              </View>
                            )}
                            {/* Badge de source */}
                            {project.project_source === 'client' && (
                              <View style={[
                                styles.sourceBadge, 
                                styles.sourceBadgePrivate,
                                selectedSource === 'client' && styles.sourceBadgeActive
                              ]}>
                                <Ionicons name="person" size={10} color="#8b5cf6" />
                                <Text style={[styles.sourceBadgeText, styles.sourceBadgeTextPrivate]}>Privé</Text>
                              </View>
                            )}
                            {project.project_source === 'marche_public' && (
                              <View style={[
                                styles.sourceBadge, 
                                styles.sourceBadgePublic,
                                selectedSource === 'marche_public' && styles.sourceBadgeActive
                              ]}>
                                <Ionicons name="globe" size={10} color="#10b981" />
                                <Text style={[styles.sourceBadgeText, styles.sourceBadgeTextPublic]}>Public</Text>
                              </View>
                            )}
                            {(project.project_source === false || project.project_source === undefined || project.project_source === null) && (
                              <View style={[
                                styles.sourceBadge, 
                                styles.sourceBadgeUndefined,
                                selectedSource === 'non_defini' && styles.sourceBadgeActive
                              ]}>
                                <Ionicons name="help-circle" size={10} color="#f59e0b" />
                                <Text style={[styles.sourceBadgeText, styles.sourceBadgeTextUndefined]}>Non défini</Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.projectChevron} />
                      </View>

                      <View style={styles.projectDetails}>
                        <View style={styles.projectInfoItem}>
                          <Ionicons name="list" size={14} color="#6b7280" />
                          <Text style={styles.projectInfoText}>
                            {project.tasks?.length || 0} tâche{(project.tasks?.length || 0) > 1 ? 's' : ''}
                          </Text>
                        </View>
                        {project.partner_id && project.partner_id[1] && (
                          <View style={styles.projectInfoItem}>
                            <Ionicons name="business" size={14} color="#6b7280" />
                            <Text style={styles.projectInfoText} numberOfLines={1}>
                              {project.partner_id[1]}
                            </Text>
                          </View>
                        )}
                        {project.create_date && (
                          <View style={[
                            styles.projectInfoItem, 
                            selectedYear !== 'all' && styles.projectInfoItemHighlight
                          ]}>
                            <Ionicons 
                              name="calendar" 
                              size={14} 
                              color={selectedYear !== 'all' ? "#2563eb" : "#6b7280"} 
                            />
                            <Text style={[
                              styles.projectInfoText, 
                              selectedYear !== 'all' && styles.projectInfoTextHighlight
                            ]}>
                              Créé le {new Date(project.create_date).toLocaleDateString('fr-FR')}
                            </Text>
                          </View>
                        )}
                        {project.type_ids && project.type_ids.length > 0 && (
                          <View style={[
                            styles.projectInfoItem, 
                            selectedTypeIds.length > 0 && styles.projectInfoItemHighlight
                          ]}>
                            <Ionicons 
                              name="layers" 
                              size={14} 
                              color={selectedTypeIds.length > 0 ? "#2563eb" : "#6b7280"} 
                            />
                            <Text style={[
                              styles.projectInfoText, 
                              selectedTypeIds.length > 0 && styles.projectInfoTextHighlight
                            ]} numberOfLines={1}>
                              {project.type_ids.map(type => {
                                const isSelected = selectedTypeIds.includes(type.id);
                                return isSelected ? `🔹 ${type.name}` : type.name;
                              }).join(', ')}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* ✅ Section Financière */}
                      <View style={styles.financialSection}>
                      <View style={styles.financialDivider} />
                      <View style={styles.financialRow}>
                      <View style={styles.financialItemSingle}>
                      <Ionicons name="wallet-outline" size={14} color="#ef4444" />
                      <Text style={styles.financialLabel}>Dépenses</Text>
                      <Text style={styles.financialExpense}>{formatAmount(financials.totalExpenses)}</Text>
                      </View>
                      </View>
                      </View>
                    </View>
                    </TouchableOpacity>
                    );
                    });
              })()
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name={(searchQuery.trim() || selectedTypeIds.length > 0 || selectedYear !== 'all' || selectedSource !== 'all') ? "search-outline" : "briefcase-outline"} size={48} color="#9ca3af" />
                <Text style={styles.emptyText}>
                  {(searchQuery.trim() || selectedTypeIds.length > 0 || selectedYear !== 'all' || selectedSource !== 'all') ? 'Aucun projet trouvé' : 'Aucun projet dans cette catégorie'}
                </Text>
                {(searchQuery.trim() || selectedTypeIds.length > 0 || selectedYear !== 'all' || selectedSource !== 'all') && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setSelectedTypeIds([]);
                      setTypeSearchQuery('');
                      setSelectedYear('all');
                      setSelectedSource('all');
                    }}
                    style={styles.clearFiltersButton}
                  >
                    <Text style={styles.clearFiltersText}>Réinitialiser les filtres</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          ) : (
            // Afficher les catégories
            filteredItems.length > 0 ? (
              filteredItems.map((category: ProjectCategory, index: number) => {
                const financials = calculateCategoryFinancials(category);
                const categoryColor = getCategoryColorByIndex(index);
                return (
                  <TouchableOpacity 
                    key={category.id} 
                    style={styles.categoryCard}
                    onPress={() => handleCategoryPress(category)}
                    activeOpacity={0.7}
                  >
                    <View style={[
                      styles.categoryColorBar,
                      { backgroundColor: categoryColor }
                    ]} />

                    <View style={styles.categoryCardContent}>
                      <View style={styles.categoryCardHeader}>
                        <View style={[
                          styles.categoryIconContainer,
                          { backgroundColor: categoryColor + '15' }
                        ]}>
                          <Ionicons 
                            name="folder" 
                            size={28} 
                            color={categoryColor} 
                          />
                        </View>
                        <View style={styles.categoryTitleContainer}>
                          <Text style={styles.categoryTitle}>{category.name}</Text>
                          <Text style={styles.categorySubtitle}>
                            {category.project_ids?.length || 0} projet{(category.project_ids?.length || 0) > 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={24} color="#9ca3af" />
                      </View>

                      {/* ✅ Section Financière */}
                      <View style={styles.financialSection}>
                        <View style={styles.financialDivider} />
                        <View style={styles.financialRow}>
                          <View style={styles.financialItemSingle}>
                            <Ionicons name="wallet-outline" size={14} color="#ef4444" />
                            <Text style={styles.financialLabel}>Dépenses</Text>
                            <Text style={styles.financialExpense}>{formatAmount(financials.totalExpenses)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name={searchQuery.trim() ? "search-outline" : "folder-outline"} size={48} color="#9ca3af" />
                <Text style={styles.emptyText}>
                  {searchQuery.trim() ? 'Aucune catégorie trouvée' : 'Aucune catégorie trouvée'}
                </Text>
              </View>
            )
          )}
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning" size={20} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>GEO LAMBERT</Text>
          <Text style={styles.footerSubtext}>
            Expertise géomatique depuis 1985
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollView: {
    flex: 1,
    zIndex: 2000,
  },
  scrollContent: {
    paddingTop: 140,
    paddingBottom: 20,
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'capitalize',
  },
  companyBanner: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#eff6ff',
  },
  companyLogoContainer: {
    width: 100,
    height: 100,
    borderRadius: 20,
    backgroundColor: '#f0f9ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 2,
    borderColor: '#bfdbfe',
  },
  companyLogo: {
    width: 85,
    height: 85,
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1e40af',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  companySlogan: {
    fontSize: 13,
    color: '#64748b',
    fontStyle: 'italic',
    marginBottom: 8,
    lineHeight: 18,
  },
  companyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  companyMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  companyMetaDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#e2e8f0',
  },
  companyDescription: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  statsContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  statIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Search/Filter Section
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    marginBottom: 20,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  clearButton: {
    padding: 4,
  },
  // Year Filter Section
  yearFiltersContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 12,
    marginBottom: 20,
  },
  yearFiltersScroll: {
    paddingHorizontal: 20,
    gap: 8,
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
    alignItems: 'center',
  },
  yearFilterChipActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  yearFilterText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b7280',
  },
  yearFilterTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  // Unified Filters Wrapper
  unifiedFiltersWrapper: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  // Filter Section Styles
  filterContainer: {
    marginBottom: 16,
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e40af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clearFilterButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#dbeafe',
    borderRadius: 8,
  },
  clearFilterText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  selectedTagsContainer: {
    marginBottom: 12,
  },
  selectedTagsContent: {
    paddingVertical: 4,
    gap: 8,
  },
  selectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 7,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    shadowColor: '#2563eb',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  selectedTagText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  selectedTagRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  typeSearchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  typeSearchIcon: {
    marginRight: 12,
  },
  typeSearchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1f2937',
    padding: 0,
  },
  typeClearButton: {
    padding: 4,
  },
  filterChipsWrapper: {
    minHeight: 48,
  },
  filterChipsContainer: {
    paddingVertical: 4,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  noTypesFoundContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderStyle: 'dashed',
    minHeight: 48,
    flexDirection: 'row',
    gap: 8,
  },
  noTypesFoundText: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '500',
  },
  activityContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  resultCount: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '600',
  },
  // Styles pour les catégories
  categoryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    flexDirection: 'row',
  },
  categoryColorBar: {
    width: 6,
  },
  categoryCardContent: {
    flex: 1,
    padding: 16,
  },
  categoryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  categoryTitleContainer: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 4,
  },
  categorySubtitle: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  // Styles pour les projets
  projectCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    flexDirection: 'row',
  },
  projectColorBar: {
    width: 4,
  },
  projectCardContent: {
    flex: 1,
    padding: 16,
  },
  projectCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectTitleContainer: {
    flex: 1,
  },
  projectTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 4,
    lineHeight: 22,
  },
  numeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
    marginRight: 6,
  },
  numeroText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3b82f6',
    letterSpacing: 0.3,
  },
  projectBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  sourceBadgeActive: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  sourceBadgeUndefined: {
    backgroundColor: '#fef3c7',
  },
  sourceBadgePublic: {
    backgroundColor: '#d1fae5',
  },
  sourceBadgePrivate: {
    backgroundColor: '#ede9fe',
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sourceBadgeTextPublic: {
    color: '#10b981',
  },
  sourceBadgeTextPrivate: {
    color: '#8b5cf6',
  },
  sourceBadgeTextUndefined: {
    color: '#f59e0b',
  },
  projectChevron: {
    marginLeft: 8,
  },
  projectDetails: {
    gap: 8,
  },
  projectInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: 8,
  },
  projectInfoItemHighlight: {
    backgroundColor: '#dbeafe',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginVertical: 2,
  },
  projectInfoText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
    flex: 1,
  },
  projectInfoTextHighlight: {
    color: '#1e40af',
    fontWeight: '700',
  },
  // ✅ Styles pour la section financière
  financialSection: {
    marginTop: 12,
  },
  financialDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 10,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  financialItemSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  financialLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  financialExpense: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ef4444',
    marginLeft: 4,
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
  },
  clearFiltersText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '600',
  },
  // Quick Filters Styles
  quickFiltersContainer: {
    gap: 12,
  },
  quickFilterSection: {
    gap: 8,
  },
  quickFilterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickFilterLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickFilterScroll: {
    gap: 6,
  },
  quickFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  quickFilterChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  quickFilterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  quickFilterTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

});
