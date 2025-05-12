import { SigningClient } from '@interchainjs/cosmos/signing-client';
import { AssetList, Chain } from "@chain-registry/v2-types"
import { BaseWallet, clientNotExistError, EndpointOptions, Endpoints, SignerOptions, SignType, Wallet, WalletAccount, WalletManager, WalletState, WCWallet } from "@interchain-kit/core"
import { SigningOptions as InterchainSigningOptions } from '@interchainjs/cosmos/types/signing-client';
import { HttpEndpoint } from '@interchainjs/types';
import { createStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist, createJSONStorage } from 'zustand/middleware'
import { dedupeAsync } from '../utils';
import { safeStrictBatchPatch } from '../utils/safeStrictBatchPatch';
import { decorateWallet } from '../utils/decorateWallet';

const immerSyncUp = (newWalletManager: WalletManager) => {
  return (draft: { chains: Chain[]; assetLists: AssetList[]; wallets: BaseWallet[]; signerOptions: SignerOptions; endpointOptions: EndpointOptions; signerOptionMap: Record<string, InterchainSigningOptions>; endpointOptionsMap: Record<string, Endpoints>; preferredSignTypeMap: Record<string, SignType>; }) => {
    draft.chains = newWalletManager.chains
    draft.assetLists = newWalletManager.assetLists
    draft.wallets = newWalletManager.wallets
    draft.signerOptions = newWalletManager.signerOptions
    draft.endpointOptions = newWalletManager.endpointOptions
    draft.signerOptionMap = newWalletManager.signerOptionMap
    draft.endpointOptionsMap = newWalletManager.endpointOptionsMap
    draft.preferredSignTypeMap = newWalletManager.preferredSignTypeMap
  }
}

export type ChainWalletState = {
  chainName: string,
  walletName: string,
  walletState: WalletState,
  rpcEndpoint: string | HttpEndpoint
  errorMessage: string
  account: WalletAccount
}

export interface InterchainStore extends WalletManager {
  chainWalletState: ChainWalletState[]
  currentWalletName: string
  currentChainName: string
  walletConnectQRCodeUri: string
  setCurrentChainName: (chainName: string) => void
  setCurrentWalletName: (walletName: string) => void
  getDraftChainWalletState: (state: InterchainStore, walletName: string, chainName: string) => ChainWalletState
  getChainWalletState: (walletName: string, chainName: string) => ChainWalletState | undefined
  updateChainWalletState: (walletName: string, chainName: string, data: Partial<ChainWalletState>) => void
  createStatefulWallet: () => void
  isReady: boolean
}

export type InterchainStoreData = {
  chains: Chain[]
  assetLists: AssetList[]
  wallets: BaseWallet[]
  signerOptions: SignerOptions
  endpointOptions: EndpointOptions
}

export const createInterchainStore = (walletManager: WalletManager) => {

  const { chains, assetLists, wallets, signerOptions, endpointOptions } = walletManager
  // const walletManager = new WalletManager(chains, assetLists, wallets, signerOptions, endpointOptions)


  return createStore(persist(immer<InterchainStore>((set, get) => ({
    chainWalletState: [],
    currentWalletName: '',
    currentChainName: '',
    chains: [...walletManager.chains],
    assetLists: [...walletManager.assetLists],
    wallets: [],
    signerOptions: walletManager.signerOptions,
    endpointOptions: walletManager.endpointOptions,

    preferredSignTypeMap: { ...walletManager.preferredSignTypeMap },
    signerOptionMap: { ...walletManager.signerOptionMap },
    endpointOptionsMap: { ...walletManager.endpointOptionsMap },

    walletConnectQRCodeUri: '',

    isReady: false,

    updateChainWalletState: (walletName: string, chainName: string, data: Partial<ChainWalletState>) => {
      set(draft => {
        let targetIndex = draft.chainWalletState.findIndex(cws => cws.walletName === walletName && cws.chainName === chainName)
        draft.chainWalletState[targetIndex] = { ...draft.chainWalletState[targetIndex], ...data }
      })
    },

    createStatefulWallet: () => {
      const wallets = walletManager.wallets.map(wallet => {
        // safeStrictBatchPatch(wallet, {
        //   connect: async (original, chainId) => {
        //     const walletName = wallet.info.name
        //     const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
        //     const state = get().getChainWalletState(walletName, chainName)?.walletState
        //     if (state === WalletState.NotExist) {
        //       return
        //     }
        //     if (walletName === 'WalletConnect' && state === WalletState.Connected) {
        //       return
        //     }
        //     set(draft => {
        //       draft.currentChainName = chainName
        //       draft.currentWalletName = walletName
        //       draft.walletConnectQRCodeUri = ''
        //     })
        //     get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connecting, errorMessage: '' })
        //     try {
        //       if (wallet instanceof WCWallet) {
        //         wallet.setOnPairingUriCreatedCallback((uri) => {
        //           set(draft => {
        //             draft.walletConnectQRCodeUri = uri
        //           })
        //         })
        //       }
        //       await original(chainId)
        //       get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connected })
        //       await get().getAccount(walletName, chainName)
        //     } catch (error) {
        //       if ((error as any).message === 'Request rejected') {
        //         get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Rejected, errorMessage: (error as any).message })
        //         return
        //       }
        //       get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, errorMessage: (error as any).message })
        //     }
        //   },
        //   disconnect: async (original, chainId) => {
        //     const walletName = wallet.info.name
        //     const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
        //     try {
        //       await original(chainId)
        //       get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, account: null })
        //     } catch (error) {
        //     }
        //   },
        //   getAccount: async (original, chainId) => {
        //     const walletName = wallet.info.name
        //     const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
        //     try {
        //       const account = await original(chainId)
        //       get().updateChainWalletState(walletName, chainName, { account })
        //       return account
        //     } catch (error) {
        //       console.log(error)
        //     }
        //   },
        //   walletState: get().getChainWalletState(wallet.info.name, walletManager.chains?.[0].chainName)?.walletState || WalletState.Disconnected
        // })



        // return wallet

        return decorateWallet(wallet, {
          connect: async (chainId) => {
            const walletName = wallet.info.name
            const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
            const state = get().getChainWalletState(walletName, chainName)?.walletState
            if (state === WalletState.NotExist) {
              return
            }
            if (walletName === 'WalletConnect' && state === WalletState.Connected) {
              return
            }
            set(draft => {
              draft.currentChainName = chainName
              draft.currentWalletName = walletName
              draft.walletConnectQRCodeUri = ''
            })
            get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connecting, errorMessage: '' })
            try {
              if (wallet instanceof WCWallet) {
                wallet.setOnPairingUriCreatedCallback((uri) => {
                  set(draft => {
                    draft.walletConnectQRCodeUri = uri
                  })
                })
              }
              await wallet.connect(chainId)
              get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connected })
              await get().getAccount(walletName, chainName)
            } catch (error) {
              if ((error as any).message === 'Request rejected') {
                get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Rejected, errorMessage: (error as any).message })
                return
              }
              get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, errorMessage: (error as any).message })
            }
          },
          disconnect: async (chainId) => {
            const walletName = wallet.info.name
            const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
            try {
              await wallet.disconnect(chainId)
              get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, account: null })
            } catch (error) {
            }
          },
          getAccount: async (chainId) => {
            const walletName = wallet.info.name
            const chainName = get().chains.find(chain => chain.chainId === chainId)?.chainName
            try {
              const account = await wallet.getAccount(chainId)
              get().updateChainWalletState(walletName, chainName, { account })
              return account
            } catch (error) {
              console.log(error)
            }
          },
          walletState: get().getChainWalletState(wallet.info.name, walletManager.chains?.[0].chainName)?.walletState || WalletState.Disconnected
        })

      })
      set(draft => {
        draft.wallets = wallets
      })
    },

    init: async () => {
      get().createStatefulWallet()

      const oldChainWalletStatesMap = new Map(get().chainWalletState.map(cws => [cws.walletName + cws.chainName, cws]))

      // should remove wallet that already disconnected ,for hydrain back from localstorage
      // const oldChainWalletStateMap = new Map()
      // get().chainWalletState.forEach(cws => {
      //   if(cws.walletState === WalletState.Connected) {
      //     oldChainWalletStateMap.set(cws.walletName + cws.chainName, cws)
      //   }
      // })

      get().wallets.forEach(wallet => {
        get().chains.forEach(chain => {
          set(draft => {
            if (!oldChainWalletStatesMap.has(wallet.info.name + chain.chainName)) {
              draft.chainWalletState.push({
                chainName: chain.chainName,
                walletName: wallet.info.name,
                walletState: WalletState.Disconnected,
                rpcEndpoint: "",
                errorMessage: "",
                account: undefined
              })
            }
          })
        })
      })

      const NotExistWallets: string[] = []
      const ExistWallets: string[] = []
      await Promise.all(get().wallets.map(async wallet => {
        try {
          await wallet.init()
          ExistWallets.push(wallet.info.name)
        } catch (error) {
          if (error === clientNotExistError) {
            NotExistWallets.push(wallet.info.name)
          }
        }
      }))
      set(draft => {
        draft.chainWalletState = draft.chainWalletState.map(cws => {
          if (NotExistWallets.includes(cws.walletName)) {
            return { ...cws, walletState: WalletState.NotExist }
          }
          return cws
        })
        draft.chainWalletState = draft.chainWalletState.map(cws => {
          if (ExistWallets.includes(cws.walletName)) {
            return { ...cws, walletState: cws.walletState === WalletState.NotExist ? WalletState.Disconnected : cws.walletState }
          }
          return cws
        })

        draft.isReady = true
      })
    },

    setCurrentChainName: (chainName: string) => {
      set(draft => { draft.currentChainName = chainName })
    },

    setCurrentWalletName: (walletName: string) => {
      set(draft => { draft.currentWalletName = walletName })
    },

    getDraftChainWalletState: (state: InterchainStore, walletName: string, chainName: string) => {
      const targetIndex = state.chainWalletState.findIndex(cws => cws.walletName === walletName && cws.chainName === chainName)
      return state.chainWalletState[targetIndex]
    },

    getChainWalletState: (walletName: string, chainName: string) => {
      return get().chainWalletState.find(cws => cws.walletName === walletName && cws.chainName === chainName)
    },

    addChains: async (newChains: Chain[], newAssetLists: AssetList[], newSignerOptions?: SignerOptions, newEndpointOptions?: EndpointOptions) => {
      await walletManager.addChains(newChains, newAssetLists, newSignerOptions, newEndpointOptions)
      // console.log(walletManager.chains, walletManager.assetLists)
      // set(immerSyncUp(walletManager))
      // set(draft => {
      //   draft.chains = walletManager.chains
      // })


      set(draft => {

        const existedChainMap = new Map(get().chains.map(chain => [chain.chainName, chain]))

        const newAssetListMap = new Map(newAssetLists.map(assetList => [assetList.chainName, assetList]))

        newChains.forEach(newChain => {
          if (!existedChainMap.has(newChain.chainName)) {
            draft.chains.push(newChain)
            draft.assetLists.push(newAssetListMap.get(newChain.chainName)!)
          }
          draft.signerOptionMap[newChain.chainName] = newSignerOptions?.signing(newChain.chainName)
          draft.endpointOptionsMap[newChain.chainName] = newEndpointOptions?.endpoints?.[newChain.chainName]
        })

        get().chains.forEach(chain => {

          draft.signerOptionMap[chain.chainName] = {
            ...get().signerOptionMap[chain.chainName],
            ...newSignerOptions?.signing(chain.chainName)
          }

          draft.endpointOptionsMap[chain.chainName] = {
            ...get().endpointOptionsMap[chain.chainName],
            ...newEndpointOptions?.endpoints?.[chain.chainName]
          }
        })

        const existedChainWalletStatesMap = new Map(get().chainWalletState.map(cws => [cws.walletName + cws.chainName, cws]))

        get().wallets.forEach(wallet => {
          newChains.forEach(newChain => {
            if (!existedChainWalletStatesMap.has(wallet.info.name + newChain.chainName)) {
              draft.chainWalletState.push({
                chainName: newChain.chainName,
                walletName: wallet.info.name,
                walletState: WalletState.Disconnected,
                rpcEndpoint: "",
                errorMessage: "",
                account: undefined
              })
            }
          })
        })

        draft.chainWalletState = draft.chainWalletState.map(cws => {
          return { ...cws, rpcEndpoint: newEndpointOptions?.endpoints?.[cws.chainName]?.rpc?.[0] || cws.rpcEndpoint }
        })
      })
    },

    connect: async (walletName: string, chainName: string) => {
      const state = get().getChainWalletState(walletName, chainName)?.walletState
      if (state === WalletState.NotExist) {
        return
      }

      if (walletName === 'WalletConnect' && state === WalletState.Connected) {
        return
      }

      set(draft => {
        draft.currentChainName = chainName
        draft.currentWalletName = walletName
        draft.walletConnectQRCodeUri = ''
      })
      get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connecting, errorMessage: '' })
      try {
        await walletManager.connect(walletName, chainName, (uri) => {
          set(draft => {
            draft.walletConnectQRCodeUri = uri
          })
        })
        get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Connected })

        await get().getAccount(walletName, chainName)
      } catch (error) {
        if ((error as any).message === 'Request rejected') {
          get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Rejected, errorMessage: (error as any).message })
          return
        }
        get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, errorMessage: (error as any).message })
      }
    },

    disconnect: async (walletName: string, chainName: string) => {
      try {
        await walletManager.disconnect(walletName, chainName)
        get().updateChainWalletState(walletName, chainName, { walletState: WalletState.Disconnected, account: null })
      } catch (error) {

      }
    },
    getAccount: async (walletName: string, chainName: string) => {
      try {
        const account = await walletManager.getAccount(walletName, chainName)
        get().updateChainWalletState(walletName, chainName, { account })
        return account
      } catch (error) {
        console.log(error)
      }
    },
    getRpcEndpoint: async (walletName: string, chainName: string): Promise<string | HttpEndpoint> => {
      return dedupeAsync(`${chainName}-rpcEndpoint`, async () => {
        const rpcEndpoint = await walletManager.getRpcEndpoint(walletName, chainName)
        get().wallets.map(wallet => {
          get().updateChainWalletState(wallet.info.name, chainName, { rpcEndpoint })
        })
        return rpcEndpoint
      })
    },
    getChainLogoUrl(chainName) {
      return walletManager.getChainLogoUrl(chainName)
    },
    getChainByName(chainName) {
      return walletManager.getChainByName(chainName)
    },
    getAssetListByName(chainName) {
      return walletManager.getAssetListByName(chainName)
    },
    getDownloadLink(walletName) {
      return walletManager.getDownloadLink(walletName)
    },
    getOfflineSigner(walletName, chainName) {
      return walletManager.getOfflineSigner(walletName, chainName)
    },
    getPreferSignType(chainName) {
      const result = walletManager.getPreferSignType(chainName)
      set(immerSyncUp(walletManager))
      return result
    },
    getSignerOptions(chainName) {
      const result = walletManager.getSignerOptions(chainName)
      set(immerSyncUp(walletManager))
      return result
    },
    getWalletByName(walletName) {
      return walletManager.getWalletByName(walletName)
    },
    async getSigningClient(walletName, chainName): Promise<SigningClient> {
      return walletManager.getSigningClient(walletName, chainName)
    },
    getEnv() {
      return walletManager.getEnv()
    },
  })), {
    name: 'interchain-kit-store',
    storage: createJSONStorage(() => localStorage),
    partialize: state => ({
      chainWalletState: state.chainWalletState.map(cws => ({
        chainName: cws.chainName,
        walletName: cws.walletName,
        account: cws.account,
        walletState: cws.walletState,
      })),
      currentWalletName: state.currentWalletName,
      currentChainName: state.currentChainName
    }),
    onRehydrateStorage: (state) => {
      // console.log('interchain-kit store hydration starts')

      // optional
      return (state, error) => {
        if (error) {
          console.log('an error happened during hydration', error)
        } else {
          // console.log('interchain-kit store hydration finished')
        }
      }
    },
  }))

}