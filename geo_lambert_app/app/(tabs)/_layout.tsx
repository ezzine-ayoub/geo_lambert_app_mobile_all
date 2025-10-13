import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {Alert, Platform} from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from "@expo/vector-icons";
import webSocketService from '@/services/webSocketService';
import projectService from '@/services/projectService';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  useEffect(() => {
    console.log('🚀 Initialisation TabLayout - Configuration WebSocket Geo Lambert...');

    // Initialiser la connexion WebSocket
    const initializeWebSocket = async () => {
      try {
        console.log('🔗 Connexion au WebSocket...');
        await webSocketService.connect();
        console.log('✅ WebSocket connecté avec succès');

        // Configurer tous les listeners Geo Lambert
        setupGeoLambertListeners();

      } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation du WebSocket:', error);
      }
    };

    // Configuration des listeners Geo Lambert
    const setupGeoLambertListeners = () => {

      // 💰 Project - Écouter les mises à jour
        webSocketService.onProjectUpdate(async (project) => {
            console.log('💰 Mise à jour Project reçue:', project.id, 'Type:', project.event_type);
        });

        webSocketService.onTaskUpdate(async (task) => {
            console.log('📋 Mise à jour Task reçue:', task.id, 'Type:', task.event_type);

        });

      // 📡 STATUT DE CONNEXION
      webSocketService.onConnectionStatusChange((connected) => {
        setIsWebSocketConnected(connected);
        if (connected) {
          console.log('✅ WebSocket reconnecté - Tous les listeners sont actifs');
        } else {
          console.log('⚠️ WebSocket déconnecté - Tentative de reconnexion automatique...');
        }
      });

      console.log('🎯 Tous les listeners Geo Lambert configurés avec succès');
    };

    // Démarrer l'initialisation
    initializeWebSocket();

    // Nettoyage au démontage du composant
    return () => {
      console.log('🧹 Nettoyage TabLayout - Déconnexion WebSocket...');

      // Nettoyer tous les listeners
      webSocketService.unsubscribeAll();

      // Déconnecter le WebSocket
      webSocketService.disconnect();

      console.log('✅ WebSocket déconnecté proprement');
    };
  }, []); // Exécuter une seule fois au montage

  return (
      <Tabs
          screenOptions={{
              tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
              headerShown: false,
              tabBarButton: HapticTab,
              tabBarBackground: TabBarBackground,
              tabBarStyle: Platform.select({
                  ios: {
                      // Use a transparent background on iOS to show the blur effect
                      position: 'absolute',
                  },
                  default: {},
              }),
          }}>
          <Tabs.Screen
              name="index"
              options={{
                  title: 'Produits',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'storefront' : 'storefront-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />

          <Tabs.Screen
              name="profile"
              options={{
                  title: 'Profil',
                  tabBarIcon: ({ color, focused }) => (
                      <Ionicons
                          name={focused ? 'person-circle' : 'person-circle-outline'}
                          size={26}
                          color={color}
                      />
                  ),
              }}
          />
          <Tabs.Screen
              name="project-details"
              options={{
                  href: null, // Cache cette page de la tab bar
              }}
          />
          <Tabs.Screen
              name="task-expenses"
              options={{
                  href: null, // Cache cette page de la tab bar
              }}
          />
      </Tabs>
  );
}
