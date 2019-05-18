import Vue from 'vue';
import { api } from '../../api';
import { ADD_SHOW } from '../mutation-types';
import { ADD_SHOW_EPISODE } from '../mutation-types';

const state = {
    shows: [],
    currentShow: {
        indexer: null,
        id: null
    }
};

const mutations = {
    [ADD_SHOW](state, show) {
        const existingShow = state.shows.find(({ id, indexer }) => Number(show.id[show.indexer]) === Number(id[indexer]));

        if (!existingShow) {
            console.debug(`Adding ${show.title || show.indexer + String(show.id)} as it wasn't found in the shows array`, show);
            state.shows.push(show);
            return;
        }

        // Merge new show object over old one
        // this allows detailed queries to update the record
        // without the non-detailed removing the extra data
        console.debug(`Found ${show.title || show.indexer + String(show.id)} in shows array attempting merge`);
        const newShow = {
            ...existingShow,
            ...show
        };

        // Update state
        Vue.set(state.shows, state.shows.indexOf(existingShow), newShow);
        console.debug(`Merged ${newShow.title || newShow.indexer + String(newShow.id)}`, newShow);
    },
    currentShow(state, { indexer, id }) {
        state.currentShow.indexer = indexer;
        state.currentShow.id = id;
    },
    [ADD_SHOW_EPISODE](state, { show, episodes }) {
        // Creating a new show object (from the state one) as we want to trigger a store update
        const newShow = Object.assign({}, state.shows.find(({ id, indexer }) => Number(show.id[show.indexer]) === Number(id[indexer])));
        
        if (!newShow.seasons) {
            newShow.seasons = [];
        }

        episodes.forEach(episode => {
            // checking if we need to create a new season item.
            
            const existingSeason = newShow.seasons.find(season => season.season === episode.season);
            if (!existingSeason) {
                const newSeason = {
                    season: episode.season,
                    episodes: [],
                    html: false,
                    mode: "span",
                    label: 1
                };
                newShow.seasons.push(newSeason);
                newSeason.episodes.push(episode);
            } else {
                const foundIndex = existingSeason.episodes.findIndex(element => element.identifier === episode.identifier);
                if (foundIndex === -1) {
                    existingSeason.episodes.push(episode);
                } else {
                    existingSeason.episodes.splice(foundIndex, 1, episode)
                }
            }
        });

        // Update state
        const existingShow = state.shows.find(({ id, indexer }) => Number(show.id[show.indexer]) === Number(id[indexer]));
        Vue.set(state.shows, state.shows.indexOf(existingShow), newShow);
        console.log(`Storing episodes for show ${newShow.title} seasons: ${[...new Set(episodes.map(episode => episode.season))].join(', ')}`);
    }

    
};

const getters = {
    getShowById: state => ({ id, indexer }) => state.shows.find(show => Number(show.id[indexer]) === Number(id)),
    getShowByTitle: state => title => state.shows.find(show => show.title === title),
    getSeason: state => ({ id, indexer, season }) => {
        const show = state.shows.find(show => Number(show.id[indexer]) === Number(id));
        return show && show.seasons ? show.seasons[season] : undefined;
    },
    getEpisode: state => ({ id, indexer, season, episode }) => {
        const show = state.shows.find(show => Number(show.id[indexer]) === Number(id));
        return show && show.seasons && show.seasons[season] ? show.seasons[season][episode] : undefined;
    },
    getCurrentShow: (state, getters, rootState) => {
        return state.shows.find(show => Number(show.id[state.currentShow.indexer]) === Number(state.currentShow.id)) || rootState.defaults.show;
    }
};

/**
 * An object representing request parameters for getting a show from the API.
 *
 * @typedef {Object} ShowParameteres
 * @property {string} indexer - The indexer name (e.g. `tvdb`)
 * @property {string} id - The show ID on the indexer (e.g. `12345`)
 * @property {boolean} detailed - Whether to fetch detailed information (seasons & episodes)
 * @property {boolean} fetch - Whether to fetch external information (for example AniDB release groups)
 */
const actions = {
    /**
     * Get show from API and commit it to the store.
     *
     * @param {*} context - The store context.
     * @param {ShowParameteres} parameters - Request parameters.
     * @returns {Promise} The API response.
     */
    getShow(context, { indexer, id, detailed, fetch }) {
        return new Promise((resolve, reject) => {
            const { commit } = context;
            const params = {};
            let timeout = 30000;

            if (detailed !== undefined) {
                params.detailed = Boolean(detailed);
                timeout = 60000;
            }

            if (fetch !== undefined) {
                params.fetch = Boolean(fetch);
                timeout = 60000;
            }

            api.get(`/series/${indexer}${id}`, { params }, { timeout })
                .then(res => {
                    commit(ADD_SHOW, res.data);
                    resolve(res.data);
                })
                .catch(error => {
                    reject(error);
                });
        });
    },
    /**
     * Get episdoes for a specified show from API and commit it to the store.
     *
     * @param {*} context - The store context.
     * @param {ShowParameteres} parameters - Request parameters.
     * @returns {Promise} The API response.
     */
    async getEpisodes({ commit, getters }, { indexer, id, season }) {
    
        const { getShowById } = getters;
        const show = getShowById({id, indexer});
        
        const limit = 1000;
        const params = {
            limit
        };

        if (season) {
            params['season'] = season;
        }

        // Get episodes
        const response = await api.get(`/series/${indexer}${id}/episodes`, { params });
        try {
            commit(ADD_SHOW_EPISODE, { show, episodes: response.data });
        } catch {
            console.log(`Could not retrieve a episodes for show ${indexer}${id}, error: ${error}`);
        }
    },
    /**
     * Get shows from API and commit them to the store.
     *
     * @param {*} context - The store context.
     * @param {ShowParameteres[]} shows - Shows to get. If not provided, gets the first 10k shows.
     * @returns {(undefined|Promise)} undefined if `shows` was provided or the API response if not.
     */
    getShows(context, shows) {
        const { commit, dispatch } = context;

        // If no shows are provided get the first 1000
        if (!shows) {
            return (() => {
                const limit = 1000;
                const page = 1;
                const params = {
                    limit,
                    page
                };

                // Get first page
                api.get('/series', { params })
                    .then(response => {
                        const totalPages = Number(response.headers['x-pagination-total']);
                        response.data.forEach(show => {
                            commit(ADD_SHOW, show);
                        });

                        // Optionally get additional pages
                        const pageRequests = [];
                        for (let page = 2; page <= totalPages; page++) {
                            const newPage = { page };
                            newPage.limit = params.limit;
                            pageRequests.push(api.get('/series', { params: newPage }).then(response => {
                                response.data.forEach(show => {
                                    commit(ADD_SHOW, show);
                                });
                            }));
                        }

                        return Promise.all(pageRequests);
                    })
                    .catch(() => {
                        console.log('Could not retrieve a list of shows');
                    });
            })();
        }

        return shows.forEach(show => dispatch('getShow', show));
    }
};

export default {
    state,
    mutations,
    getters,
    actions
};
