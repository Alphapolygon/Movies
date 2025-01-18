const API_KEY = '3bbf380371a2169bd25b710058646650'; // Store API Key as a constant
const BASE_API_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w200';
const ORIGINAL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original';
const FILMOGRAPHY_REQUEST_DELAY = 1000;
const CREDITS_PER_PAGE = 10;
let currentSearchType = 'movie';
let userRegion = 'US';
let filmographyRequestTimer;

// Cache to store API responses in memory
let apiCache = {
    genres: {},
    credits: {}
};

// DOM Elements (Cache these for better performance)
const movieInput = document.getElementById('movieInput');
const suggestionsList = document.getElementById('suggestions');
const searchForm = document.getElementById('searchForm');
const resultsContainer = document.getElementById('resultsContainer');
const loader = document.getElementById('loader');



function setupTypeButtons() {
    const buttons = document.querySelectorAll('.search-type-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            // Use a more performant way to toggle classes:
            buttons.forEach(btn => btn.classList.toggle('active', btn === button));
            currentSearchType = button.dataset.type;

            // Optionally trigger a search immediately when the type changes:
            // searchContent(); 
        });
    });
}

async function detectUserRegion() {
    const cachedRegion = localStorage.getItem('userRegions'); // More consistent key name
    if (cachedRegion) {
        userRegion = cachedRegion;
        console.log(`Using cached region: ${userRegion}`);
        return userRegion;
    }

    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) {
            throw new Error(`Failed to fetch region: ${response.status} ${response.statusText}`); // More informative error
        }
        const data = await response.json();
        userRegion = data.country_code;
        console.log(`Detected region: ${userRegion}`);
        localStorage.setItem('userRegion', userRegion); // More consistent key name
        return userRegion;
    } catch (error) {
        console.error('Error detecting user region:', error);
        userRegion = 'US';
        return userRegion;
    }
}

async function fetchData(url) {
    if (apiCache[url]) {
        return apiCache[url];  // Return cached response if available
    }

    const response = await fetch(url);
    const data = await response.json();
    apiCache[url] = data;  // Cache the fetched response

    return data;
}


// ... (getMovieSuggestions, detectUserRegion, setupTypeButtons remain mostly the same)

async function searchContent() {
    await detectUserRegion();
    const movieName = movieInput.value.trim();
    if (!movieName) {
        alert("Please enter a movie or TV show name.");
        return;
    }

    try {
        showLoader();
        let results;
        switch (currentSearchType) {
            case 'movie':
                results = await searchItems('movie', movieName);
                displayResults(results, true);
                break;
            case 'tv':
                results = await searchItems('tv', movieName);
                displayResults(results, false);
                break;
            case 'actor':
                const actors = await searchActors(movieName);
                if (actors && actors.length > 0) {
                    displayActorResults(actors);
                } else {
                    alert("No actors found.");
                }
                break;
        }

    } catch (error) {
        console.error('Error:', error);
        alert("An error occurred. Please try again.");
    } finally {
        hideLoader();
    }
}

async function searchItems(type, query) {
    const searchId = await getItemId(type, query);
    if (!searchId) {
        alert("Item not found. Please check the spelling and try again.");
        return null;
    }
    const similarItems = await getSimilarItems(type, searchId);
    const searchedItem = await getItemData(type, searchId);
    if (!searchedItem) return null;

    const providers = await getWatchProviders(searchId, type);
    searchedItem.watch = getWatchData(providers);

    const similarItemsWithProviders = await Promise.all(similarItems.map(async (item) => {
        const providers = await getWatchProviders(item.id, item.media_type);
        return { ...item, watch: getWatchData(providers) };
    }));
    return { searchedItem, similarItems: similarItemsWithProviders };
}

async function getItemId(type, query) {
    const url = `${BASE_API_URL}/search/${type}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    const data = await fetchData(url);
    return data?.results?.[0]?.id || null;
}

async function getSimilarItems(type, itemId) {
    const url = `${BASE_API_URL}/${type}/${itemId}/recommendations?api_key=${API_KEY}&language=en-US&page=1`;
    return (await fetchData(url))?.results || [];
}

async function getItemData(type, itemId) {
    const url = `${BASE_API_URL}/${type}/${itemId}?api_key=${API_KEY}`;
    return await fetchData(url);
}

async function getWatchProviders(itemId, type) {
    const url = `${BASE_API_URL}/${type}/${itemId}/watch/providers?api_key=${API_KEY}`;
    return (await fetchData(url))?.results;
}

function getWatchData(providers) {
    const regionData = providers && providers[userRegion];
    return {
        link: regionData?.link,
        flatrate: regionData?.flatrate,
    };
}

async function searchActors(actorName) {
    const url = `${BASE_API_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(actorName)}`;
    return (await fetchData(url))?.results || null;
}

async function fetchAndDisplayPopularMovies() {
    const url = `${BASE_API_URL}/discover/movie?api_key=${API_KEY}&language=en-US&sort_by=popularity.desc&page=1`;

    try {
        const data = await fetchData(url);
        if (!data || !data.results) {
          console.error("No popular movies data received.");
          return;
        }
        // Add isPopular property and CAP to 10
        const popularMovies = data.results.slice(0, 10).map(movie => ({ ...movie, isPopular: true }));

        const popularMoviesWithProviders = await Promise.all(popularMovies.map(async (movie) => {
          const providers = await getWatchProviders(movie.id, 'movie');
          return {...movie, watch: getWatchData(providers)};
        }));

        displayPopular(popularMoviesWithProviders);
    } catch (error) {
        console.error("Error fetching popular movies:", error);
    } finally {
        hideLoader();
    }
}

function displayPopular(movies) {
    resultsContainer.innerHTML = ''; // Clear previous results

    movies.forEach(movie => {
        displayItem(movie, true, resultsContainer, true);
    });
}

async function displayResults(results, isMovie) {
    resultsContainer.innerHTML = '';

    if (!results) {
        alert("No results to display.");
        return;
    }

    const { searchedItem, similarItems } = results;

    try {
        if (searchedItem) {
            displayItem(searchedItem, isMovie, resultsContainer, true);
            await delay(1000); // Delay before showing similar items
        }

        if (similarItems && similarItems.length > 0) {
            const separatorRow = document.createElement('div');
            separatorRow.classList.add('separator-row');
            separatorRow.textContent = `People who watched ${searchedItem.title || searchedItem.name} also watched:`;
            resultsContainer.appendChild(separatorRow);

            similarItems.forEach(item => {
                displayItem(item, item.media_type === 'movie', resultsContainer, false);
            });
        }
    } catch (error) {
        console.error("Error displaying results:", error);
        alert("An error occurred displaying the results.");
    }
}


// ... (fetchAndDisplayPopularMovies remains mostly the same, but use fetchData)

// ... (displayResults, displayItem, displayActorResults, displayActorFilmography, getActorCredits remain mostly the same, but use fetchData and helper functions)

async function displayResults(results, isMovie) {
    resultsContainer.innerHTML = '';

    if (!results) {
        alert("No results to display.");
        return;
    }

    const { searchedItem, similarItems } = results;

    try {
        if (searchedItem) {
            displayItem(searchedItem, isMovie, resultsContainer, true);
            await delay(1000); // Delay before showing similar items
        }

        if (similarItems && similarItems.length > 0) {
            const separatorRow = document.createElement('div');
            separatorRow.classList.add('separator-row');
            separatorRow.textContent = `People who watched ${searchedItem.title || searchedItem.name} also watched:`;
            resultsContainer.appendChild(separatorRow);

            similarItems.forEach(item => {
                displayItem(item, item.media_type === 'movie', resultsContainer, false);
            });
        }
    } catch (error) {
        console.error("Error displaying results:", error);
        alert("An error occurred displaying the results.");
    }
}

async function displayItem(item, isMovie, container, isMainItem, isFromFilmography = false) {
    if (!isMainItem && !isFromFilmography && (!item.watch || !item.watch.flatrate || item.watch.flatrate.length === 0)) {
        return; // Don't display if no streaming providers are available (unless it's the main item or from filmography)
    }

    const movieElement = document.createElement('div');
    movieElement.classList.add('movieItem');

    const imageContainer = document.createElement('div');
    imageContainer.classList.add('image-container');
    const imgLink = document.createElement('a');
    imgLink.href = '#';
    imgLink.addEventListener('click', async () => {
        movieInput.value = item.title || item.name;
        // Set the correct search type button active
        const buttons = document.querySelectorAll('.search-type-button');
        buttons.forEach(btn => btn.classList.remove('active'));
        const targetButton = document.querySelector(`.search-type-button[data-type="${isMovie ? 'movie' : 'tv'}"]`);
        if (targetButton) {
            targetButton.classList.add('active');
            currentSearchType = isMovie ? 'movie' : 'tv';
        }
        await searchContent();
    });

    const img = new Image();
    img.src = item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : 'placeholder.jpg';
    img.alt = item.title || item.name;
    img.style.cursor = 'pointer';
    imgLink.appendChild(img);
    imageContainer.appendChild(imgLink);
    movieElement.appendChild(imageContainer);

    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('movieDetails');
    detailsContainer.style.display = 'grid';
    detailsContainer.style.gridTemplateColumns = '1fr 1fr';
    detailsContainer.style.gap = '5px';

    const column1 = document.createElement('div');
    const column2 = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = item.title || item.name;
    column1.appendChild(title);

	const releaseDate = document.createElement('p');
	const date = item.release_date || item.first_air_date;

	if (date) {
	  const year = new Date(date).getFullYear();
	  releaseDate.textContent = `Release Year: ${year}`;
	} else {
	  releaseDate.textContent = "Release Year: N/A";
	}

	column1.appendChild(releaseDate);

    const genreParagraph = document.createElement('p');
    genreParagraph.textContent = "Genres: ";
    const genreNames = await getGenreNames(item.genre_ids || item.genres?.map(g => g.id), isMovie); // Handle both genre_ids and full genre objects
    genreParagraph.textContent += genreNames.length ? genreNames.join(", ") : "N/A";
    column1.appendChild(genreParagraph);

    const voteAverage = document.createElement('p');
    voteAverage.innerHTML = `Rating: ${item.vote_average ? item.vote_average.toFixed(1) + ' ⭐' : 'N/A'}`;
    column1.appendChild(voteAverage);

    const providersContainer = document.createElement('div');
    providersContainer.classList.add('providersContainer');
    if (item.watch && item.watch.flatrate) {
        item.watch.flatrate.forEach(provider => {
            const providerLink = document.createElement('a');
            providerLink.href = item.watch.link || "#"; // Use the watch link or a fallback
            providerLink.target = '_blank';
            providerLink.rel = 'noopener noreferrer';

            const providerImg = new Image();
            providerImg.src = provider.logo_path ? `${ORIGINAL_IMAGE_BASE_URL}${provider.logo_path}` : 'default-provider-logo.png';
            providerImg.alt = provider.provider_name;
            providerImg.style.width = '50px';

            providerLink.appendChild(providerImg);
            providersContainer.appendChild(providerLink);
        });
    }
    column1.appendChild(providersContainer);

    try {
        const credits = await getCredits(item.id, isMovie);
        if (credits && credits.crew) {
            const director = credits.crew.find(person => person.job === 'Director');
            if (director) {
                const directorLink = document.createElement('a');
                directorLink.href = '#';
                directorLink.textContent = `Director: ${director.name}`;
                directorLink.addEventListener('click', () => handlePersonClick(director.name, "actor"));

                column2.appendChild(directorLink);
                column2.appendChild(document.createElement('br'));
            }
        }

        if (credits && credits.cast && credits.cast.length > 0) {
            const castHeading = document.createElement('p');
            castHeading.textContent = "Cast:";
            column2.appendChild(castHeading);

            const topCast = credits.cast.slice(0, 5);
            topCast.forEach(actor => {
                const actorLink = document.createElement('a');
                actorLink.href = '#';
                actorLink.textContent = actor.name;
                actorLink.addEventListener('click', () => handlePersonClick(actor.name, "actor"));
                column2.appendChild(actorLink);
               
            });
            if(column2.lastChild){
                column2.lastChild.remove();
            }
        }
    } catch (error) {
        console.error("Error fetching credits:", error);
    }

    detailsContainer.appendChild(column1);
    detailsContainer.appendChild(column2);
    movieElement.appendChild(detailsContainer);
    container.appendChild(movieElement);
}

async function getCredits(itemId, isMovie) {
    const type = isMovie ? 'movie' : 'tv';
    const url = `${BASE_API_URL}/${type}/${itemId}/credits?api_key=${API_KEY}`;
    return await fetchData(url);
}

async function getGenreNames(genreIds, isMovie) {
    if (!genreIds || genreIds.length === 0) return [];

    const type = isMovie ? 'movie' : 'tv';
    const cachedGenres = JSON.parse(localStorage.getItem(`${type}_genres`)) || {};

    let missingGenreIds = genreIds.filter(id => !cachedGenres[id]);
    if (missingGenreIds.length > 0) {
        const url = `${BASE_API_URL}/genre/${type}/list?api_key=${API_KEY}&language=en-US`;
        const data = await fetchData(url);
        if (data && data.genres) {
            data.genres.forEach(genre => cachedGenres[genre.id] = genre.name);
            localStorage.setItem(`${type}_genres`, JSON.stringify(cachedGenres));
        }
    }

    return genreIds.map(id => cachedGenres[id]).filter(name => name);
}

function handlePersonClick(personName, searchType) {
    movieInput.value = personName;
    const buttons = document.querySelectorAll('.search-type-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    const targetButton = document.querySelector(`.search-type-button[data-type="${searchType}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
        currentSearchType = searchType;
    }
    searchContent();
}

async function displayActorResults(actors) {
    resultsContainer.innerHTML = '';

    for (const actor of actors) {
        const actorDiv = document.createElement('div');
        actorDiv.classList.add('movieItem');

        const img = document.createElement('img');
        img.src = actor.profile_path ? `${IMAGE_BASE_URL}${actor.profile_path}` : 'placeholder.jpg';
        img.alt = actor.name;
        actorDiv.appendChild(img);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('movieDetails');

        const nameHeading = document.createElement('h2');
        nameHeading.textContent = actor.name;
        detailsDiv.appendChild(nameHeading);

        const filmographyButton = document.createElement('button');
        filmographyButton.textContent = 'Filmography';
        filmographyButton.classList.add('filmography-button');
        filmographyButton.addEventListener('click', async () => {
            if (filmographyRequestTimer) {
                clearTimeout(filmographyRequestTimer);
            }

            filmographyRequestTimer = setTimeout(async () => {
                filmographyRequestTimer = null;
                await displayActorFilmography(actor.id, actor.name);
            }, FILMOGRAPHY_REQUEST_DELAY);
        });
        detailsDiv.appendChild(filmographyButton);

        actorDiv.appendChild(detailsDiv);
        resultsContainer.appendChild(actorDiv);
    }
}

async function displayActorFilmography(actorId, actorName) {
    resultsContainer.innerHTML = '';

    let allCredits = [];
    let currentStartIndex = 0;
    let filmographyWithProviders = [];

    try {
        const credits = await getActorCredits(actorId);
        if (credits && credits.cast) {
            allCredits = [...credits.cast, ...credits.crew];

            // Filter credits (before provider fetching)
            allCredits = allCredits.filter(credit =>
                credit.character &&
                credit.character.trim() !== "" &&
                credit.character !== "Self" &&
                credit.character !== actorName
            );

            //Make credits unique based on id
            const uniqueCredits = [];
            const seenIds = new Set();
            for (const credit of allCredits) {
                if (credit.id && !seenIds.has(credit.id)) {
                    uniqueCredits.push(credit);
                    seenIds.add(credit.id);
                }
            }
            allCredits = uniqueCredits;

            allCredits.sort((a, b) => new Date(b.release_date || b.first_air_date || 0) - new Date(a.release_date || a.first_air_date || 0));

            if (allCredits.length === 0) {
                const noResultsMessage = document.createElement("p");
                noResultsMessage.textContent = `No filmography found for ${actorName}`;
                resultsContainer.appendChild(noResultsMessage);
                return;
            }

            filmographyWithProviders = await Promise.all(allCredits.map(async (item) => {
                try {
                    const isMovie = item.media_type === 'movie';
                    const providers = await getWatchProviders(item.id, item.media_type);
                    item.watch = getWatchData(providers);
                    return item;
                } catch (error) {
                    console.error("Error fetching providers for filmography item:", error);
                    return { ...item, watch: null };
                }
            }));

            // Sort with provider priority
            filmographyWithProviders.sort((a, b) => {
                const aHasProviders = a.watch && a.watch.flatrate && a.watch.flatrate.length > 0;
                const bHasProviders = b.watch && b.watch.flatrate && b.watch.flatrate.length > 0;
                const dateA = new Date(a.release_date || a.first_air_date || 0);
                const dateB = new Date(b.release_date || b.first_air_date || 0);

                if (aHasProviders && !bHasProviders) return -1;
                if (!aHasProviders && bHasProviders) return 1;

                return dateB - dateA;
            });

            displayNextCredits();

            const loadMoreButton = document.createElement('button');
            loadMoreButton.textContent = 'Load More';
            loadMoreButton.classList.add('filmography-button', 'load-more-button'); // Combined classes
            loadMoreButton.addEventListener('click', displayNextCredits);
            resultsContainer.appendChild(loadMoreButton);

        } else {
            alert("Could not retrieve filmography.");
        }
    } catch (error) {
        console.error("Error fetching actor credits:", error);
        alert("An error occurred fetching filmography.");
    }

    function displayNextCredits() {
        const nextCredits = filmographyWithProviders.slice(currentStartIndex, currentStartIndex + CREDITS_PER_PAGE);
        if (nextCredits.length === 0) {
            const loadMoreButton = document.querySelector(".load-more-button");
            if (loadMoreButton) loadMoreButton.remove();
            return;
        }

        const tempContainer = document.createElement('div');
        nextCredits.forEach(credit => {
            displayItem(credit, credit.media_type === 'movie', tempContainer, false, true);
        });
        resultsContainer.insertBefore(tempContainer, document.querySelector(".load-more-button"));
        currentStartIndex += CREDITS_PER_PAGE;

        if (currentStartIndex >= filmographyWithProviders.length) {
            const loadMoreButton = document.querySelector(".load-more-button");
            if (loadMoreButton) loadMoreButton.remove();
        }
    }
}

async function getActorCredits(actorId) {
    const cacheKey = `${BASE_API_URL}/person/${actorId}/combined_credits?api_key=${API_KEY}`;
    
    if (apiCache.credits[cacheKey]) {
        return apiCache.credits[cacheKey];  // Return cached credits if available
    }

    try {
        const response = await fetchData(cacheKey);
        apiCache.credits[cacheKey] = response;  // Cache the fetched credits
        return response;
    } catch (error) {
        console.error("Error fetching actor credits:", error);
        return null;
    }
}

async function getMovieSuggestions(query) {
    const url = `${BASE_API_URL}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error("Error fetching suggestions", error);
        return []; // Return an empty array in case of error, to prevent further issues
    }
}

function showLoader() {
    loader.style.display = 'block';
}

function hideLoader() {
    loader.style.display = 'none';
}



// Event Listeners
let timeoutId; // Declare timeoutId in the outer scope

movieInput.addEventListener('input', () => {
    clearTimeout(timeoutId); // Clear previous timeout (even if it's undefined initially, clearTimeout handles it)

    timeoutId = setTimeout(async () => {
        const query = movieInput.value.trim();
        if (query.length < 3) {
            suggestionsList.innerHTML = '';
            return;
        }
        const suggestions = await getMovieSuggestions(query);
        suggestionsList.innerHTML = '';
        if (suggestions && suggestions.length > 0) {
            suggestions.forEach(suggestion => {
                const li = document.createElement('li');
                li.textContent = suggestion.title || suggestion.name;
                li.addEventListener('click', () => {
                    movieInput.value = suggestion.title || suggestion.name;
                    suggestionsList.innerHTML = '';
                });
                suggestionsList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = "No result found";
            suggestionsList.appendChild(li);
        }
    }, 300);
});

searchForm.addEventListener('submit', () => {
    suggestionsList.innerHTML = '';
});

document.addEventListener('click', (event) => {
    if (!movieInput.contains(event.target) && !suggestionsList.contains(event.target)) {
        suggestionsList.innerHTML = '';
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndDisplayPopularMovies();
    setupTypeButtons();
});

//Helper function to delay execution
const delay = ms => new Promise(res => setTimeout(res, ms));