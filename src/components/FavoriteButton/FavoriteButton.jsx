import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import css from './FavoriteButton.module.css';
import { createResourceLocatorString } from '../../util/routes';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { handleToggleFavorites } from '../../containers/ListingPage/ListingPage.shared';
import {
  profileUpdateInProgressSelector,
  updateProfile,
} from '../../containers/ProfileSettingsPage/ProfileSettingsPage.duck';
import ExtraIcons from '../ExtraIcons/ExtraIcons';

const FavoriteButton = props => {
  const { isAuthenticated } = useSelector(state => state.auth);
  const { currentUser } = useSelector(state => state.user);
  const history = useHistory();
  const dispatch = useDispatch();
  const routeConfiguration = useRouteConfiguration();
  const profileUpdateInProgress = useSelector(profileUpdateInProgressSelector);

  const { rootClassName, className, iconClassName, listingId, isVisible, listingAuthor } = props;
  const currentListingId = listingId?.uuid ?? listingId;
  const favorites = currentUser?.attributes.profile.privateData.favorites ?? [];
  const [isFavorite, setIsFavorite] = useState(favorites.includes(currentListingId));

  const classes = rootClassName || classNames(css.root, className);
  const iconClasses = classNames(iconClassName, {
    [css.icon]: !iconClassName,
    [css.bookmarked]: isFavorite,
  });

  const isComponentDisabled =
    !isVisible ||
    !currentListingId ||
    // !currentUser ||
    // !isAuthenticated ||
    listingAuthor?.id?.uuid === currentUser?.id?.uuid;

  const handleClick = useCallback(
    e => {
      e.preventDefault();
      e.stopPropagation();

      if (profileUpdateInProgress) {
        return;
      }

      if (!isAuthenticated) {
        history.push(createResourceLocatorString('LoginPage', routeConfiguration, {}, {}));
        return;
      }

      setIsFavorite(!isFavorite);

      handleToggleFavorites({
        currentUser,
        routes: routeConfiguration,
        location: history.location,
        history,
        params: { id: currentListingId },
        onUpdateFavorites: payload => dispatch(updateProfile(payload)),
      })(isFavorite);
    },
    [isFavorite, currentUser, profileUpdateInProgress, isAuthenticated]
  );

  useEffect(() => {
    setIsFavorite(isFavorite);
  }, [isFavorite]);

  if (isComponentDisabled) {
    return null;
  }

  console.log('yolooo');
  return (
    <div
      className={classes}
      role="button"
      onClick={handleClick}
      aria-disabled={`${profileUpdateInProgress}`}
    >
      <ExtraIcons className={iconClasses} icon={isFavorite ? 'heartIcon' : 'heartOutline'} />
    </div>
  );
};

export default FavoriteButton;
