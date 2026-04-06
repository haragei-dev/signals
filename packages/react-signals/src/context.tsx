import { createContext, useContext, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { createStore } from '@haragei/signals';
import type { Store } from '@haragei/signals';
import { createStoreResolver } from './internal';

const StoreContext = createContext<Store | undefined>(undefined);
const resolveClientStore = createStoreResolver();

export interface SignalsProviderProps extends PropsWithChildren {
    readonly store?: Store;
}

export function SignalsProvider({ store, children }: SignalsProviderProps) {
    const localStore = useRef<Store | undefined>(undefined);

    if (!store) {
        localStore.current ??= createStore();
    }

    return (
        <StoreContext.Provider value={store ?? localStore.current}>
            {children}
        </StoreContext.Provider>
    );
}

export function useSignalStore(): Store {
    return useContext(StoreContext) ?? resolveClientStore();
}
